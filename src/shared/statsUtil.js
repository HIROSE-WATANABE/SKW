import Enum from 'enum';
import util from './util';

const StatsRefs = new Enum([
  'RTCOutboundRtpVideoStreams',
  'RTCOutboundRtpAudioStreams',
  'RTCInboundRtpVideoStreams',
  'RTCInboundRtpAudioStreams',
  'RTCRemoteInboundRtpVideoStreams',
  'RTCRemoteInboundRtpAudioStreams',
  'RTCAudioSenders',
  'RTCVideoReceivers',
  'RTCAudioReceivers',
  'RTCIceCandidatePairs',
]);

/**
 * Get a map which detects the stats object reference that differs depending on the browser.
 * @return {Map} - A Map which has a pair of stats reference and its key. Returns `null` if it detect the unknown browser.
 */
function getDialectalReferenceMap() {
  const { name } = util.detectBrowser();

  if (name === 'chrome') {
    return CHROME_REFERENCE_MAP;
  } else if (name === 'firefox') {
    return FIREFOX_REFERENCE_MAP;
  } else if (name === 'safari') {
    return SAFARI_REFERENCE_MAP;
  }

  return null;
}

/**
 * Check if the stats is which noted by stats object reference.
 * @param {RTCStats} [stats] - An RTCStats which will be tested.
 * @param {Object} [referKeys] - An object with the set of an attribute and a value to identify a stats.
 * @return {boolean} - True if its referred stats.
 */
function isReferredStats(stats, referKeys) {
  const referKeysArray = [...Object.entries(referKeys)];
  return referKeysArray.every(([key, value]) => stats[key] === value);
}

/**
 * Resolve the differences of the form of RTCStatsReport between browser, and retrieve preferred value.
 * @param {RTCStatsReport} [originalReport] - An original RTCStatsReport from the result of [pc|sender|receiver].getStats().
 * @return {Map} A standardized RTCStatsReport like object. Returns `null` if it detect the unknown browser.
 */
function standardizeStatsReport(originalReport) {
  const report = new Map();
  const referenceMap = getDialectalReferenceMap();

  if (referenceMap === null) {
    return null;
  }

  // scan with stats reference and generate stats report in the iterations.
  for (const [ref, referKeys] of referenceMap.entries()) {
    for (const originalStats of originalReport.values()) {
      // if it matches referKeys, register the stats with reference and quit to search the original stats.
      if (isReferredStats(originalStats, referKeys)) {
        const stats = {};

        // get the preferred value from original stats.
        for (const attr of PREFFERED_STATS_MAP.get(ref)) {
          if (originalStats[attr] === undefined) {
            stats[attr] = originalStats[attr];
          } else {
            stats[attr] = null;
          }
        }

        // update the stats object
        if (report.has(ref)) {
          const statsArray = report.get(ref);
          statsArray.push(stats);
          report.set(ref, statsArray);
        } else {
          report.set(ref, [stats]);
        }

        break;
      }
    }
  }

  return report;
}

/**
 * Class that controlls getStats.
 */
class StatsHarvester {
  constructor(rtcpc, lifetime = 1000) {
    this._pc = rtcpc;
    this._cached = {
      stats: new Map(),
      timestamp: 0,
    };
    this._LIFETIME = lifetime;
  }

  // retrieve RTCStats for video sender
  _getViedoSenderStats(report, previousReport) {
    // While we only support single-track stream, this method only care about 1 transceiver.
    const RTCOutboundRtpVideoStreamStats = report.get(
      StatsRefs.RTCOutboundRtpVideoStreams.key
    )[0];
    const RTCRemoteInboundRtpVideoStreamStats = report.get(
      StatsRefs.RTCRemoteInboundRtpVideoStreams.key
    )[0];

    const stats = {
      qpValue: null,
      bitrate: null,
      jitter: RTCRemoteInboundRtpVideoStreamStats.jitter,
      rtt: RTCRemoteInboundRtpVideoStreamStats.roundTripTime,
    };

    // calculate QP value
    if (
      RTCOutboundRtpVideoStreamStats.qpSum !== null &&
      RTCOutboundRtpVideoStreamStats.framesEncoded !== null
    ) {
      stats.qpValue =
        RTCOutboundRtpVideoStreamStats.qpSum /
        RTCOutboundRtpVideoStreamStats.framesEncoded;
    }

    // if bytesSent does not present, it is not needed to read previousReport
    if (RTCOutboundRtpVideoStreamStats.bytesSent !== null) {
      const previous = {
        RTCOutboundRtpVideoStreamStats: previousReport.get(
          StatsRefs.RTCOutboundRtpVideoStreams.key
        )[0],
      };

      // calculate bitrate with previous value
      if (previous.RTCOutboundRtpVideoStreamStats.bytesSent !== null) {
        const bytesSentDelta =
          RTCOutboundRtpVideoStreamStats.bytesSent -
          previous.RTCOutboundRtpVideoStreamStats.bytesSent;
        const timeDelta =
          RTCOutboundRtpVideoStreamStats.timestamp -
          previous.RTCOutboundRtpVideoStreamStats.timestamp;

        // convert bytes/ms to bit/sec
        const bytesPerMs = bytesSentDelta / timeDelta;
        stats.bitrate = bytesPerMs * 8 * 1000;
      }
    }

    return stats;
  }

  // retrieve RTCStats for audio sender
  _getAudioSenderStats(report, previousReport) {
    // While we only support single-track stream, this method only care about 1 transceiver.
    const RTCAudioSenderStats = report.get(StatsRefs.RTCAudioSenders.key)[0];
    const RTCOutboundRtpAudioStreamStats = report.get(
      StatsRefs.RTCOutboundRtpAudioStreams.key
    )[0];
    const RTCRemoteInboundRtpAudioStreamStats = report.get(
      StatsRefs.RTCRemoteInboundRtpAudioStreams.key
    )[0];

    const stats = {
      bitrate: null,
      audioLevel: RTCAudioSenderStats.audioLevel,
      jitter: RTCRemoteInboundRtpAudioStreamStats.jitter,
      rtt: RTCRemoteInboundRtpAudioStreamStats.roundTripTime,
    };

    // if bytesSent does not present, it is not needed to read previousReport
    if (RTCOutboundRtpAudioStreamStats.bytesSent !== null) {
      const previous = {
        RTCOutboundRtpAudioStreamStats: previousReport.get(
          StatsRefs.RTCOutboundRtpAudioStreams.key
        )[0],
      };

      if (previous.RTCOutboundRtpAudioStreamStats.bytesSent !== null) {
        const bytesSentDelta =
          RTCOutboundRtpAudioStreamStats.bytesSent -
          previous.RTCOutboundRtpAudioStreamStats.bytesSent;
        const timeDelta =
          RTCOutboundRtpAudioStreamStats.timestamp -
          previous.RTCOutboundRtpAudioStreamStats.timestamp;

        // convert bytes/ms to bit/sec
        const bytesPerMs = bytesSentDelta / timeDelta;
        stats.bitrate = bytesPerMs * 8 * 1000;
      }
    }

    return stats;
  }

  // retrieve RTCStats for video receiver
  _getVideoReceiverStats(report, previousReport) {
    const RTCVideoReceiverStats = report.get(
      StatsRefs.RTCVideoReceivers.key
    )[0];
    const RTCInboundRtpVideoStreamStats = report.get(
      StatsRefs.RTCInboundRtpVideoStreams.key
    )[0];

    const stats = {
      fractionLost: null,
      qpValue: null,
      bitrate: null,
      jitterBufferDelay: RTCVideoReceiverStats.jitterBufferDelay,
    };

    // calculate fractionLost
    if (
      RTCInboundRtpVideoStreamStats.packetsLost !== null &&
      RTCInboundRtpVideoStreamStats.bytesReceived !== null
    ) {
      stats.fractionLost =
        RTCInboundRtpVideoStreamStats.packetsLost /
        RTCInboundRtpVideoStreamStats.bytesReceived;
    }

    // calculate QP Value
    if (
      RTCInboundRtpVideoStreamStats.qpSum !== null &&
      RTCInboundRtpVideoStreamStats.framesDecoded !== null
    ) {
      stats.qpValue =
        RTCInboundRtpVideoStreamStats.qpSum /
        RTCInboundRtpVideoStreamStats.framesDecoded;
    }

    // if bytesReceived does not present, it is not needed to read previousReport
    if (RTCInboundRtpVideoStreamStats.bytesReceived !== null) {
      const previous = {
        RTCInboundRtpVideoStreamStats: previousReport.get(
          StatsRefs.RTCInboundRtpVideoStreams.key
        )[0],
      };

      // calculate bitrate
      if (previous.RTCInboundRtpVideoStreamStats.bytesReceived !== null) {
        const bytesReceivedDelta =
          RTCInboundRtpVideoStreamStats.bytesReceived -
          previous.RTCInboundRtpVideoStreamStats.bytesReceived;
        const timeDelta =
          RTCInboundRtpVideoStreamStats.timestamp -
          previous.RTCInboundRtpVideoStreamStats.timestamp;

        // convert bytes/ms to bit/sec
        const bytestPerMs = bytesReceivedDelta / timeDelta;
        stats.bitrate = bytestPerMs * 8 * 1000;
      }
    }

    return stats;
  }

  // retrieve RTCStats for audio receiver
  _getAudioReceiverStats(report, previousReport) {
    const RTCAudioReceiverStats = report.get(
      StatsRefs.RTCAudioReceivers.key
    )[0];
    const RTCInboundRtpAudioStreamStats = report.get(
      StatsRefs.RTCInboundRtpAudioStreams.key
    )[0];

    const stats = {
      bitrate: null,
      fractionLost: null,
      audioLevel: RTCAudioReceiverStats.audioLevel,
      jitterBufferDelay: RTCAudioReceiverStats.jitterBufferDelay,
    };

    // calculate fractionLost
    if (
      RTCInboundRtpAudioStreamStats.packetsLost !== null &&
      RTCInboundRtpAudioStreamStats.packetsReceived !== null
    ) {
      stats.fractionLost =
        RTCInboundRtpAudioStreamStats.packetsLost /
        RTCInboundRtpAudioStreamStats.bytesReceived;
    }

    // if bytesReceived does not present, it is not needed to read previousReport
    if (RTCInboundRtpAudioStreamStats.bytesReceived !== null) {
      const previous = {
        RTCInboundRtpAudioStreamStats: previousReport.get(
          StatsRefs.RTCInboundRtpAudioStreams.key
        )[0],
      };

      // calculate bitrate with previous value
      if (previous.RTCInboundRtpAudioStreamStats.bytesReceived !== null) {
        const bytesReceivedDelta =
          RTCInboundRtpAudioStreamStats.bytesReceived -
          previous.RTCInboundRtpAudioStreamStats.bytesReceived;
        const timeDelta =
          RTCInboundRtpAudioStreamStats.timestamp -
          previous.RTCInboundRtpAudioStreamStats.timestamp;

        // convert bytes/ms to bit/sec
        const bytestPerMs = bytesReceivedDelta / timeDelta;
        stats.bitrate = bytestPerMs * 8 * 1000;
      }
    }

    return stats;
  }

  // retrieve RTCStats for ICE transport
  _getCandidatePairStats(report, previousReport) {
    const RTCIceCandidatePairStats = report
      .get(StatsRefs.RTCIceCandidatePairs.key)
      .find(stat => stat.nominated);

    const stats = {
      upstreamBitrate: null,
      downstreamBitrate: null,
      rtt: RTCIceCandidatePairStats.currentRoundTripTime,
    };

    // if bytesSent and bytesReceived does not present, it is not needed to read previousReport
    if (
      RTCIceCandidatePairStats.bytesSent !== null ||
      RTCIceCandidatePairStats.bytesReceived !== null
    ) {
      const previous = {
        RTCIceCandidatePairStats: previousReport
          .get(StatsRefs.RTCIceCandidatePairs.key)
          .find(stat => stat.nominated),
      };

      // calculate sending bitrate with previous value
      if (previous.RTCIceCandidatePairStats.bytesSent !== null) {
        const bytesSentDelta =
          RTCIceCandidatePairStats.bytesSent -
          previous.RTCIceCandidatePairStats.bytesSent;
        const timeDelta =
          RTCIceCandidatePairStats.timestamp -
          previous.RTCIceCandidatePairStats.timestamp;

        // convert bytes/ms to bit/sec
        const bytestPerMs = bytesSentDelta / timeDelta;
        stats.upstreamBitrate = bytestPerMs * 8 * 1000;
      }

      // calculate receiving bitrate with previous value
      if (previous.RTCIceCandidatePairStats.bytesReceived !== null) {
        const bytesReceivedDelta =
          RTCIceCandidatePairStats.bytesReceived -
          previous.RTCIceCandidatePairStats.bytesReceived;
        const timeDelta =
          RTCIceCandidatePairStats.timestamp -
          previous.RTCIceCandidatePairStats.timestamp;

        // convert bytes/ms to bit/sec
        const bytestPerMs = bytesReceivedDelta / timeDelta;
        stats.downstreamBitrate = bytestPerMs * 8 * 1000;
      }
    }

    return stats;
  }

  async getStats() {
    // getStats should not polled too frequently so we cache its result by 1 second.
    const currentTimestamp = Date.now();
    if (
      this._cached.stats !== null &&
      currentTimestamp - this._cached.timestamp < this._LIFETIME
    ) {
      return this._cached.stats;
    }

    const originalReport = await this._pc.getStats();

    // standardize RTCStatsReport
    const report = standardizeStatsReport(originalReport);
    const stats = {
      send: {
        audio: this._getAudioSenderStats(report, this._cached.stats),
        video: this._getVideoSenderStats(report, this._cached.stats),
      },
      receive: {
        audio: this._getAudioReceiverStats(report, this._cached.stats),
        video: this._getVideoReceiverStats(report, this._cached.stats),
      },
      candidatePair: this._getCandidatePairStats(report, this._cached.stats),
    };

    this._cached.stats = stats;
    this._cached.timestamp = currentTimestamp;

    return stats;
  }
}

// A map with the name of preferred attribute for each stats object.
const PREFFERED_STATS_MAP = new Map([
  [
    'RTCOutboundRtpVideoStreams',
    ['qpSum', 'framesEncoded', 'bytesSent', 'timestamp'],
  ],
  ['RTCOutboundRtpAudioStreams', ['bytesSent', 'timestamp']],
  [
    'RTCInboundRtpVideoStreams',
    ['packetsLost', 'bytesReceived', 'framesEncoded', 'qpSum', 'timestamp'],
  ],
  ['RTCInboundRtpAudioStreams', ['packetsLost', 'bytesReceived', 'timestamp']],
  ['RTCRemoteInboundRtpVideoStreams', ['jitter', 'roundTripTime']],
  ['RTCRemoteInboundRtpAudioStreams', ['jitter', 'roundTripTime']],
  ['RTCAudioSenders', ['audioLevel']],
  ['RTCVideoReceivers', ['jitterBufferDelay']],
  ['RTCAudioReceivers', ['audioLevel', 'jitterBufferDelay']],
  [
    'RTCIceCandidatePairs',
    ['bytesSent', 'bytesReceived', 'timestamp', 'currentRoundTripTime'],
  ],
]);

// A map with a key to identify stats object reference on Chrome.
const CHROME_REFERENCE_MAP = new Map([
  ['RTCOutboundRtpVideoStreams', { type: 'outbound-rtp', kind: 'video' }],
  ['RTCOutboundRtpAudioStreams', { type: 'outbound-rtp', kind: 'audio' }],
  ['RTCInboundRtpVideoStreams', { type: 'inbound-rtp', kind: 'video' }],
  ['RTCInboundRtpAudioStreams', { type: 'inbound-rtp', kind: 'audio' }],
  [
    'RTCRemoteInboundRtpVideoStreams',
    { type: 'remote-inbound-rtp', kind: 'video' },
  ],
  [
    'RTCRemoteInboundRtpAudioStreams',
    { type: 'remote-inbound-rtp', kind: 'audio' },
  ],
  ['RTCAudioSenders', { type: 'track', kind: 'audio', remoteSource: false }],
  ['RTCVideoReceivers', { type: 'track', kind: 'video', remoteSource: true }],
  ['RTCAudioReceivers', { type: 'track', kind: 'audio', remoteSource: true }],
  ['RTCIceCandidatePairs', { type: 'candidate-pair', nominated: false }],
]);

// A map with a key to identify stats object reference on Firefox.
const FIREFOX_REFERENCE_MAP = new Map([
  ['RTCOutboundRtpVideoStreams', { type: 'outbound-rtp', kind: 'video' }],
  ['RTCOutboundRtpAudioStreams', { type: 'outbound-rtp', kind: 'audio' }],
  ['RTCInboundRtpVideoStreams', { type: 'inbound-rtp', kind: 'video' }],
  ['RTCInboundRtpAudioStreams', { type: 'inbound-rtp', kind: 'audio' }],
  [
    'RTCRemoteInboundRtpVideoStreams',
    { type: 'remote-inbound-rtp', kind: 'video' },
  ],
  [
    'RTCRemoteInboundRtpAudioStreams',
    { type: 'remote-inbound-rtp', kind: 'audio' },
  ],
  ['RTCAudioSenders', { type: 'outbound-rtp', kind: 'audio' }],
  ['RTCVideoReceivers', { type: 'inbound-rtp', kind: 'video' }],
  ['RTCAudioReceivers', { type: 'inbound-rtp', kind: 'audio' }],
  ['RTCIceCandidatePairs', { type: 'candidate-pair', nominated: false }],
]);

// A map with a key to identify stats object reference on Safari.
const SAFARI_REFERENCE_MAP = new Map([
  ['RTCOutboundRtpVideoStreams', { type: 'outbound-rtp', kind: 'video' }],
  ['RTCOutboundRtpAudioStreams', { type: 'outbound-rtp', kind: 'audio' }],
  ['RTCInboundRtpVideoStreams', { type: 'inbound-rtp', kind: 'video' }],
  ['RTCInboundRtpAudioStreams', { type: 'inbound-rtp', kind: 'audio' }],
  [
    'RTCRemoteInboundRtpVideoStreams',
    { type: 'remote-inbound-rtp', kind: 'video' },
  ],
  [
    'RTCRemoteInboundRtpAudioStreams',
    { type: 'remote-inbound-rtp', kind: 'audio' },
  ],
  ['RTCAudioSenders', { type: 'track', kind: 'audio', remoteSource: false }],
  ['RTCVideoReceivers', { type: 'track', kind: 'video', remoteSource: true }],
  ['RTCAudioReceivers', { type: 'track', kind: 'audio', remoteSource: true }],
  ['RTCIceCandidatePairs', { type: 'candidate-pair', nominated: false }],
]);

export default { StatsHarvester };
