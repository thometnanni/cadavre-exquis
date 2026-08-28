# Cadavre Exquis

## Hardware

- raspberry pi 5
- 5 epson TM-T88 receipt printers (various generations)
- adapters
- led matrix

We connect 4 printers through usb (some with serial to usb / parallel to usb adapters) and 1 serial printer through gpio via a MAX3232 board.

### Printers

Serial printers should be set to baud rate 19200. This can be done by setting the dip switches on the bottom of the printers. Check the manual for your printer versions. Alternatively, the baud rate could also be set in the Python script.

It matters which printer is connected to which usb port. I’ve added stickers to the cables and raspberry pi to match them up. But you can also update the order in the node.js script `api/index.js` or rearrange the printers.

### GPIO

I build a connector if this gets lost you might want to rewire everything:

#### MAX3232 wiring

tbd

#### Led Matrix

tbd

## Raspberry Setup

use _raspberry pi imager_ to install Raspberry Pi OS Lite. use hostname, username and password `print`. put sd card in raspberry pi, start then ssh into:

```
ssh print@print.local
```

…or figure out your the pi’s address.

for ease of use install zsh & ohmyzsh

```
sudo apt install zsh
sudo apt-get install git
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
```

### configure interfaces

```
sudo raspi-config
```

- Interface Options → SPI → Enable
- Interface Options → Serial Port → login shell over serial: No → serial hardware enabled: Yes

### install packages

```
sudo apt update
sudo apt install -y python3-venv python3-dev libusb-1.0-0-dev libjpeg-dev zlib1g-dev
```

### install node

```
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.6/install.sh | bash
\. "$HOME/.nvm/nvm.sh"
nvm install 24
node -v
```

### clone repository

```
git clone https://github.com/thometnanni/cadavre-exquis.git
```

### setup esc-pos python script

```
cd ~/cadavre-exquis/image-printer
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# alternatively install manually
# pip install python-escpos Pillow pyserial pyusb
# pip freeze > requirements.txt
```

### user groups

```
sudo usermod -aG dialout,lp,plugdev,spi,gpio $USER
```

### udev rules

```
sudo tee /etc/udev/rules.d/99-printers.rules << 'EOF'
# Epson TM-T88III over native USB — libusb access, kick usblp off it
SUBSYSTEM=="usb", ATTRS{idVendor}=="04b8", ATTRS{idProduct}=="0202", MODE="0666", RUN+="/bin/sh -c 'echo -n %k > /sys/bus/usb/drivers/usblp/unbind 2>/dev/null || true'"

# CH340S USB-to-parallel adapter — needs usblp to get its /dev/usb/lp* node
SUBSYSTEM=="usb", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="7584", RUN+="/sbin/modprobe usblp"
EOF

sudo udevadm control --reload-rules && sudo udevadm trigger
```

### reboot

```
sudo reboot
```

### test printing

```
cd ~/cadavre-exquis/image-printer
source .venv/bin/activate

python3 print.py detect

python3 print.py print test.jpg

python3 print.py cut
```

### setup api / server

```
cd ~/cadavre-exquis/api/
npm i
```

launch once

```
node index.js
```

for development (autorestarts on changes)

```
npm run dev
```

### autostart the server

```
sudo nano /etc/systemd/system/printer-server.service
```

find node exec path

```
which node
```

```
# /etc/systemd/system/printer-server.service

[Unit]
Description=Printer drawing server
After=network.target

[Service]
Type=simple
User=print
WorkingDirectory=/home/print/cadavre-exquis/api
ExecStart=/home/print/.nvm/versions/node/v24.19.0/bin/node server.js
Restart=always
RestartSec=2
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

enable

```
sudo systemctl enable --now printer-server
```

disable

```
sudo systemctl disable --now printer-server
```

### network

the raspberry pi can spawn it’s own offline network

```
sudo nmcli connection add \\
  type wifi \\
  ifname wlan0 \\
  con-name hotspot \\
  autoconnect no \\
  ssid "printprint" \\
  mode ap \\
  802-11-wireless.band bg \\
  ipv4.method shared \\
  ipv4.addresses 192.168.4.1/24 \\
  wifi-sec.key-mgmt wpa-psk \\
  wifi-sec.psk "cadavreroll"
```

An added connection is not automatically enabled. If you’re connected to the pi over ssh over ethernet or have direct shell access you can down the existing mobile network and up the hotspot using `nmcli connection down/up`. Just make sure to not down the connection you’re using to ssh into the pi.

It is usually safer to change the autoconnect settings:

```
sudo nmcli connection modify hotspot autoconnect yes
sudo nmcli connection modify [other network con-name] autoconnect no
```

some helpful commands

```
nmcli connection show
nmcli device status
nmcli device wifi list
```

## exhibition setup

connect your device to the wifi `printprint` using the password `cadavreroll`.

the exhibition iPad has the numerical passcode `397847` (`exquis`). the same code is used for exiting guided access.

open the kiosk app, enable guided access by triple clicking the home button. the three dots at the top of the screen should now disappear.

you can change the url of the kiosk browser app in the settings app.
