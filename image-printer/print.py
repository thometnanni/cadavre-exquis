#!/usr/bin/env python3
"""
Receipt printer detection and image printing via ESC/POS.
Supports USB (native), USB-to-serial, and USB-to-parallel adapters.

Dependencies:
    pip install python-escpos Pillow pyserial
    # For USB: also needs libusb
    # sudo apt install libusb-1.0-0-dev
"""

import sys
import glob
import argparse
import threading
from pathlib import Path
from PIL import Image, ImageOps


# ── Printer detection ─────────────────────────────────────────────────────────

def find_usb_printers():
    """
    Detect USB printers via python-escpos USB backend.
    Returns list of (vendorid, productid, serial) tuples for known Epson devices.
    """
    try:
        import usb.core
    except ImportError:
        print("[warn] pyusb not available, skipping USB detection")
        return []

    # Epson vendor ID; extend with other vendors as needed
    EPSON_VID = 0x04b8
    devices = []
    found = usb.core.find(idVendor=EPSON_VID, find_all=True)
    if found:
        for dev in found:
            try:
                serial = usb.util.get_string(dev, dev.iSerialNumber) if dev.iSerialNumber else None
            except Exception:
                serial = None
            devices.append({
                "type": "usb",
                "vendor_id": dev.idVendor,
                "product_id": dev.idProduct,
                "serial": serial,
                "label": f"USB {dev.idVendor:04x}:{dev.idProduct:04x} (serial={serial})",
            })
    return devices


def find_serial_printers():
    """
    Detect USB-to-serial adapters as /dev/ttyUSB* or /dev/ttyACM*.
    GPIO UART (/dev/ttyAMA0) is excluded here; use find_gpio_printer() for that.
    """
    patterns = ["/dev/ttyUSB*", "/dev/ttyACM*"]
    devices = []
    for pattern in patterns:
        for port in sorted(glob.glob(pattern)):
            devices.append({
                "type": "serial",
                "port": port,
                "label": f"Serial {port}",
            })
    return devices


def find_gpio_printer():
    """
    Detect a printer connected via the RPi hardware UART (GPIO14/15).
    Only included if /dev/ttyAMA0 exists and is accessible.
    """
    port = "/dev/ttyAMA0"
    if not Path(port).exists():
        return []
    return [{
        "type": "serial",
        "port": port,
        "label": f"Serial {port} (GPIO hardware UART)",
    }]


def _get_udev_vid(path):
    """Return the USB vendor ID (lowercase hex string) for a /dev/usb/lp* device."""
    import subprocess
    try:
        out = subprocess.check_output(
            ["udevadm", "info", "-a", path],
            text=True, stderr=subprocess.DEVNULL
        )
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("ATTRS{idVendor}=="):
                return line.split('"')[1].lower()
    except Exception:
        pass
    return None


# Known USB-to-parallel adapter vendor IDs.
# 1a86 = CH340/WCH (most common cheap adapters)
# Add others here if needed.
PARALLEL_ADAPTER_VIDS = {"1a86"}


def find_parallel_printers():
    """
    Detect USB-to-parallel adapters (/dev/usb/lp*).
    Filters by known adapter vendor IDs to avoid matching USB printers
    that also expose an lp interface.
    """
    devices = []
    for path in sorted(glob.glob("/dev/usb/lp*")):
        vid = _get_udev_vid(path)
        if vid is None:
            print(f"[warn] could not determine vendor for {path}, including anyway")
        elif vid not in PARALLEL_ADAPTER_VIDS:
            continue
        devices.append({
            "type": "parallel",
            "path": path,
            "label": f"Parallel (USB adapter) {path}",
        })
    return devices


def detect_all_printers():
    printers = []
    printers.extend(find_usb_printers())
    printers.extend(find_serial_printers())
    printers.extend(find_gpio_printer())
    printers.extend(find_parallel_printers())
    return printers


# ── Printer connection ────────────────────────────────────────────────────────

def connect_printer(device, serial_baud=19200, serial_timeout=1):
    """
    Return a connected python-escpos printer object for a detected device dict.
    """
    from escpos import printer as ep

    t = device["type"]

    if t == "usb":
        return ep.Usb(
            device["vendor_id"],
            device["product_id"],
            timeout=0,
            in_ep=0x82,   # adjust if needed; 0x82 is common for Epson
            out_ep=0x01,
        )

    elif t == "serial":
        return ep.Serial(
            devfile=device["port"],
            baudrate=serial_baud,
            bytesize=8,
            parity="N",
            stopbits=1,
            timeout=serial_timeout,
            dsrdtr=False,   # set True if your printer needs DSR/DTR handshake
        )

    elif t == "parallel":
        return ep.File(device["path"])

    else:
        raise ValueError(f"Unknown device type: {t}")


# ── Image preparation ─────────────────────────────────────────────────────────

def prepare_image(image_path, printer_width_px=512, dither=True):
    """
    Load an image, resize to printer width, convert to 1-bit B&W.

    Args:
        image_path:       Path to input image (any Pillow-supported format)
        printer_width_px: Printable width in pixels (512 for 80mm @ 203dpi,
                          384 for 58mm @ 203dpi)
        dither:           Use Floyd-Steinberg dithering (True) or hard threshold (False)
    """
    img = Image.open(image_path).convert("RGBA")

    # Flatten alpha onto white background
    background = Image.new("RGBA", img.size, (255, 255, 255, 255))
    background.paste(img, mask=img.split()[3])
    img = background.convert("RGB")

    # Resize to printer width, maintain aspect ratio
    w, h = img.size
    new_h = int(h * printer_width_px / w)
    img = img.resize((printer_width_px, new_h), Image.LANCZOS)

    img = img.rotate(180)

    # Convert to greyscale
    img = ImageOps.autocontrast(img.convert("L"))

    # Convert to 1-bit
    if dither:
        img = img.convert("1")  # Pillow uses Floyd-Steinberg by default
    else:
        img = img.point(lambda x: 0 if x < 128 else 255, "1")

    return img

# —— Cut job ———————————————————————————————————————————————————————————————————

def cut_on_device(device, serial_baud=19200):
    """
    Connect to a device and cut.
    """
    print(f"  [{device['label']}] connecting ...")
    p = connect_printer(device, serial_baud=serial_baud)
    print(f"  [{device['label']}] cutting ...")

    p.cut()
    print(f"  [{device['label']}] done.")

# ── Print job ─────────────────────────────────────────────────────────────────

def print_image_to_device(device, img, cut=False, serial_baud=19200):
    """
    Connect to a device and send a pre-prepared image.
    """
    print(f"  [{device['label']}] connecting ...")
    p = connect_printer(device, serial_baud=serial_baud)
    print(f"  [{device['label']}] printing ...")
    p.image(img)
    if cut:
        p.cut()
    print(f"  [{device['label']}] done.")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Detect receipt printers and print images via ESC/POS")
    subparsers = parser.add_subparsers(dest="command")

    # detect
    subparsers.add_parser("detect", help="List all detected printers")

    # cut
    p_cut = subparsers.add_parser("cut", help="Cut one or all printers")
    p_cut.add_argument(
        "--printer", "-p",
        help="Printer index from 'detect' output (omit to cut all)",
        type=int,
        default=None,
    )
    p_cut.add_argument("--baud", type=int, default=19200,
        help="Baud rate for serial printers (default: 19200)")

    # print
    p_print = subparsers.add_parser("print", help="Print an image to one or all printers")
    p_print.add_argument("image", help="Path to image file")
    p_print.add_argument(
        "--printer", "-p",
        help="Printer index from 'detect' output (omit to print to all)",
        type=int,
        default=None,
    )
    p_print.add_argument("--width", type=int, default=512,
                         help="Printable width in pixels (default: 512 for 80mm)")
    p_print.add_argument("--no-dither", action="store_true",
                         help="Use hard threshold instead of Floyd-Steinberg dithering")
    p_print.add_argument("--cut", action="store_true",
                         help="Send cut command after printing")
    p_print.add_argument("--baud", type=int, default=19200,
                         help="Baud rate for serial printers (default: 19200)")

    args = parser.parse_args()

    if args.command == "detect" or args.command is None:
        printers = detect_all_printers()
        if not printers:
            print("No printers detected.")
        else:
            print(f"Found {len(printers)} printer(s):")
            for i, dev in enumerate(printers):
                print(f"  [{i}] {dev['label']}")
        if args.command is None:
            parser.print_help()

    elif args.command == "cut":
        printers = detect_all_printers()
        if not printers:
            print("No printers detected.")
            sys.exit(1)

        targets = [printers[args.printer]] if args.printer is not None else printers

        def job(device):
            try:
                cut_on_device(
                    device,
                    serial_baud=args.baud,
                )
            except Exception as e:
                print(f"  [{device['label']}] error: {e}")

        threads = [threading.Thread(target=job, args=(d,)) for d in targets]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

    elif args.command == "print":
        if not Path(args.image).exists():
            print(f"Error: image file not found: {args.image}")
            sys.exit(1)

        printers = detect_all_printers()
        if not printers:
            print("No printers detected.")
            sys.exit(1)

        targets = [printers[args.printer]] if args.printer is not None else printers

        # Prepare image once, reuse across all printers
        print(f"Preparing image {args.image} ...")
        img = prepare_image(args.image, printer_width_px=args.width, dither=not args.no_dither)
        print(f"  {img.size[0]}×{img.size[1]}px, sending to {len(targets)} printer(s) ...")

        def job(device):
            try:
                print_image_to_device(
                    device, img,
                    cut=args.cut,
                    serial_baud=args.baud,
                )
            except Exception as e:
                print(f"  [{device['label']}] error: {e}")

        threads = [threading.Thread(target=job, args=(d,)) for d in targets]
        for t in threads:
            t.start()
        for t in threads:
            t.join()


if __name__ == "__main__":
    main()