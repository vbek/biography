# Board games: playing across devices

Ludo and Snakes & Ladders can be played on one device or across several. Each player uses their own device and one device hosts the game.

## From the website: QR code or room code

1. Open the game and choose **Host on this network**.
2. Other players scan the QR code or enter the room code.

The site uses the public PeerJS service to introduce the devices, so this needs internet for a moment. After that, moves travel directly between the devices.

## From your own computer: IP address, no internet needed

A website can't accept incoming connections, so joining by IP needs this small script. It requires [Node.js](https://nodejs.org) and nothing else.

```
node games/party/host-server.js
```

It prints an address such as `http://192.168.1.20:8787/games/`.

1. Open that address on the host computer and choose **Host on this network**.
2. Other devices on the same Wi-Fi scan the QR code, open the address, or type the IP into **Join a room** on the live site.

To use another port, run `node games/party/host-server.js 9000`.

If other devices can't connect:

- Allow Node.js through your firewall for private networks.
- Check that the devices are on the same Wi-Fi. Guest networks often block devices from reaching each other.
- If the computer has several network adapters, choose a different address in the room screen.

The script shares the website's files with your network while it runs, but never hidden files such as `.git`. Press Ctrl+C to stop it.
