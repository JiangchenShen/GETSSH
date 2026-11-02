'use strict';

/*
 * WebRTC probes for the plugin page smoke tests (plugin-page-smoke.cjs, plugin-renderer-smoke.cjs).
 * A page reaches a server through WebRTC without any request CSP sees: the STUN and TURN servers
 * it names, and the remote candidates it adds or writes into an SDP answer, which get ICE
 * connectivity checks carrying a username the page chose. Every probe has its own loopback UDP or
 * TCP port, so a test sees which of them arrived.
 *
 * Host names (*.webrtc.test; .test is reserved for testing) go to 127.0.0.1 through Chromium's
 * host resolver rules, which the smoke test sets before the app is ready.
 */

const dgram = require('node:dgram');
const net = require('node:net');

const HOST = '127.0.0.1';
const HOST_RESOLVER_RULES = 'MAP *.webrtc.test* 127.0.0.1';

// Probes ending in -udp listen on UDP, the others on TCP.
const PROBES = [
  'stun-udp', // a STUN server
  'turn-udp', // a TURN server over UDP
  'turn-tcp', // a TURN server over TCP
  'turns-tcp', // a TURN server over TLS
  'turn-name-tcp', // a TURN server by host name
  'candidate-udp', // remote candidates added with addIceCandidate()
  'candidate-tcp',
  'sdp-udp', // remote candidates written into the SDP answer
  'sdp-tcp',
  'sdp-name-udp', // the same by host name
  'sdp-name-tcp',
];

/** What a sink records when a probe from the given tag (where the probe runs) arrives. */
function webrtcLabels(tag) {
  return PROBES.map(probe => `webrtc ${tag} ${probe}`);
}

/** Loopback ports for each probe of each tag, and what arrived on them. */
async function openWebRtcSinks(tags) {
  const ports = {};
  const closers = [];
  let arrived = new Set();
  for (const tag of tags) {
    ports[tag] = {};
    for (const probe of PROBES) {
      const label = `webrtc ${tag} ${probe}`;
      if (probe.endsWith('-udp')) {
        const socket = dgram.createSocket('udp4');
        socket.on('message', () => arrived.add(label));
        await new Promise((resolve, reject) => { socket.once('error', reject); socket.bind(0, HOST, resolve); });
        ports[tag][probe] = socket.address().port;
        closers.push(() => socket.close());
      } else {
        const server = net.createServer(connection => {
          arrived.add(label);
          connection.on('error', () => {});
          connection.destroy();
        });
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, HOST, resolve); });
        ports[tag][probe] = server.address().port;
        closers.push(() => server.close());
      }
    }
  }
  return {
    ports,
    arrived: () => [...arrived].sort(),
    reset: () => { arrived = new Set(); },
    close: () => closers.forEach(close => close()),
  };
}

/**
 * Script source of an expression that runs every probe against the given ports and resolves to
 * { tag, result }: 'done' after three seconds of ICE, or the error that stopped it (a page
 * without RTCPeerConnection throws a ReferenceError at once). `peerConnection` is the expression
 * for the constructor, such as another frame's.
 */
function webrtcProbeScript(tag, ports, peerConnection = 'RTCPeerConnection') {
  const p = ports;
  const line = text => `${text}\\r\\n`;
  const sdpCandidates = [
    line(`a=candidate:3 1 udp 2122260223 ${HOST} ${p['sdp-udp']} typ host`),
    line(`a=candidate:4 1 tcp 1518280447 ${HOST} ${p['sdp-tcp']} typ host tcptype passive`),
    line(`a=candidate:5 1 udp 2122260223 sdp-name.webrtc.test ${p['sdp-name-udp']} typ host`),
    line(`a=candidate:6 1 tcp 1518280447 sdp-name.webrtc.test ${p['sdp-name-tcp']} typ host tcptype passive`),
  ].join('');
  return `(async () => {
  const out = { tag: ${JSON.stringify(tag)} };
  try {
    const pc = new (${peerConnection})({ iceServers: [
      { urls: 'stun:${HOST}:${p['stun-udp']}' },
      { urls: 'turn:${HOST}:${p['turn-udp']}?transport=udp', username: 'leak', credential: 'leak' },
      { urls: 'turn:${HOST}:${p['turn-tcp']}?transport=tcp', username: 'leak', credential: 'leak' },
      { urls: 'turns:${HOST}:${p['turns-tcp']}?transport=tcp', username: 'leak', credential: 'leak' },
      { urls: 'turn:turn-name.webrtc.test:${p['turn-name-tcp']}?transport=tcp', username: 'leak', credential: 'leak' },
    ] });
    pc.createDataChannel('probe');
    await pc.setLocalDescription(await pc.createOffer());
    // An answer with the page's own ICE username, and remote candidates written into it.
    const answer = pc.localDescription.sdp
      .replace(/a=mid:0\\r\\n/, 'a=mid:0\\r\\n${sdpCandidates}')
      .replace(/a=setup:actpass/g, 'a=setup:active')
      .replace(/a=ice-ufrag:[^\\r\\n]*/g, 'a=ice-ufrag:leak')
      .replace(/a=ice-pwd:[^\\r\\n]*/g, 'a=ice-pwd:leakleakleakleakleakleak');
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    await pc.addIceCandidate({ candidate: 'candidate:1 1 udp 2122260223 ${HOST} ${p['candidate-udp']} typ host', sdpMid: '0', sdpMLineIndex: 0 });
    await pc.addIceCandidate({ candidate: 'candidate:2 1 tcp 1518280447 ${HOST} ${p['candidate-tcp']} typ host tcptype passive', sdpMid: '0', sdpMLineIndex: 0 });
    await new Promise(resolve => setTimeout(resolve, 3000));
    pc.close();
    out.result = 'done';
  } catch (e) {
    out.result = 'error: ' + e.name;
  }
  return out;
})()`;
}

module.exports = { HOST_RESOLVER_RULES, openWebRtcSinks, webrtcLabels, webrtcProbeScript };
