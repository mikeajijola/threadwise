import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { audioScript } from '../ui/audio';
import { segmentSchema, latestTranscript, type Segment } from '../lib/schema';
import { randomUUID } from 'node:crypto';

class Track extends EventTarget {
  readyState = 'live'; stopped = false;
  constructor(public kind: string, public label: string) { super(); }
  stop() { this.stopped = true; this.readyState = 'ended'; }
  getSettings() { return { displaySurface: 'browser' }; }
}
class Stream {
  constructor(public tracks: Track[]) {}
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
}
function setup(options: { noAudio?: boolean; denyMic?: boolean; displayPromise?: Promise<Stream>; voiced?: boolean } = {}) {
  const tab = new Track('audio','meeting'); const video = new Track('video','meeting-video'); const mic = new Track('audio','local-mic'); const mixed = new Track('audio','mixed');
  const display = new Stream(options.noAudio ? [video] : [video,tab]);
  const starts: (Track | undefined)[] = [], sources: string[] = [], states: any[] = [], errors: string[] = [], finals: any[] = [];
  const timers = new Map<number, () => void>(); let timer = 0, closed = false, recognizer: any, micRequests = 0;
  let now = 1000; const intervals = new Map<number, { fn: () => void; ms: number; last: number }>();
  class Recognition {
    onstart: any; onresult: any; onend: any; onerror: any;
    constructor() { recognizer = this; }
    start(track?: Track) { starts.push(track); this.onstart?.(); }
    stop() { this.onend?.(); }
    abort() {}
  }
  const node = () => ({ connect() { return this; }, gain: { value: 1 } });
  class AudioContext {
    resume() { return Promise.resolve(); }
    close() { closed = true; return Promise.resolve(); }
    createGain() { return node(); }
    createMediaStreamSource(stream: Stream) { sources.push(stream.getAudioTracks()[0].label); return node(); }
    createMediaStreamDestination() { return { stream: new Stream([mixed]) }; }
    createAnalyser() { return { ...node(), fftSize: 256, getByteTimeDomainData(samples: Uint8Array) { samples.fill(options.voiced ? 160 : 128); } }; }
  }
  const env: any = {
    navigator: { userAgent: 'Mozilla/5.0 Chrome/145.0.0.0 Safari/537.36', mediaDevices: {
      getDisplayMedia: () => options.displayPromise || Promise.resolve(display),
      getUserMedia: () => { micRequests++; return options.denyMic ? Promise.reject(Object.assign(Error('denied'),{name:'NotAllowedError'})) : Promise.resolve(new Stream([mic])); },
    } }, AudioContext, MediaStream: Stream, SpeechRecognition: Recognition,
    setTimeout: (fn: () => void) => { timers.set(++timer,fn); return timer; },
    clearTimeout: (id: number) => timers.delete(id), setInterval: (fn: () => void, ms: number) => { intervals.set(++timer,{fn,ms,last:now}); return timer; }, clearInterval(id: number) { intervals.delete(id); }, crypto: { randomUUID },
  };
  runInNewContext(audioScript, { window: env, Uint8Array, console, Date: { now: () => now } });
  const capture = new env.CopilotAudioCapture({ onState: (s: unknown) => states.push(s), onError: (e: string) => errors.push(e), onFinal: (value: string,source: string,metadata: object) => finals.push({value,source,...metadata}) });
  return { capture, env, starts, sources, states, errors, finals, tab, video, mic, mixed, display, timers, tick() { now += 150; for(const entry of intervals.values())if(now-entry.last>=entry.ms){entry.last=now;entry.fn();} }, get closed() { return closed; }, get recognizer() { return recognizer; }, get micRequests() { return micRequests; } };
}
test('tab audio and microphone feed one mixed track; recognition never starts with no track', async () => {
  const s=setup(); await s.capture.startTab(true);
  assert.deepEqual(s.sources,['meeting','local-mic']); assert.equal(s.starts[0],s.mixed);
  s.recognizer.onresult({resultIndex:0,results:[Object.assign([{transcript:'The cart stays empty.'}],{isFinal:true})]});
  assert.equal(s.finals[0].value,'The cart stays empty.'); assert.equal(s.finals[0].source,'tab-audio'); assert.equal(s.finals[0].provisional,false);
  await s.capture.stop(); assert.ok(s.tab.stopped&&s.video.stopped&&s.mic.stopped&&s.mixed.stopped&&s.closed);
});
test('tab-only mode does not request a microphone and reconnects to the same captured track', async () => {
  const s=setup(); await s.capture.startTab(false); assert.equal(s.micRequests,0);
  s.recognizer.onend(); const restart=[...s.timers.values()][0]; restart();
  assert.equal(s.starts.length,2); assert.ok(s.starts.every(t=>t===s.mixed)); await s.capture.stop();
});
test('sharing without audio fails visibly and stops video without starting microphone recognition', async () => {
  const s=setup({noAudio:true}); await s.capture.startTab(true);
  assert.match(s.errors[0],/no audio/); assert.equal(s.starts.length,0); assert.equal(s.micRequests,0); assert.ok(s.video.stopped&&s.closed);
});
test('denied microphone in combined mode stops the shared source rather than pretending both sides are captured', async () => {
  const s=setup({denyMic:true}); await s.capture.startTab(true);
  assert.match(s.errors[0],/denied/); assert.equal(s.starts.length,0); assert.ok(s.tab.stopped&&s.video.stopped&&s.closed);
});
test('a share granted after the user pressed Stop is immediately released', async () => {
  let grant!: (stream: Stream) => void;
  const s=setup({displayPromise:new Promise(resolve=>{grant=resolve;})});
  const starting=s.capture.startTab(false); await s.capture.stop(); grant(s.display); await starting;
  assert.equal(s.starts.length,0); assert.ok(s.tab.stopped&&s.video.stopped&&s.closed);
});
test('browser stop-sharing and speech service failure clean up tracks and prevent restarts', async () => {
  const s=setup(); await s.capture.startTab(false); s.video.dispatchEvent(new Event('ended'));
  assert.equal(s.capture.run,null); assert.ok(s.tab.stopped&&s.video.stopped);
  const failed=setup(); await failed.capture.startTab(false); failed.recognizer.onerror({error:'network'});
  assert.equal(failed.capture.run,null); assert.match(failed.errors[0],/network/); assert.ok(failed.tab.stopped&&failed.closed);
});
test('Android, Safari and old Chromium cannot silently ignore the audio-track argument', () => {
  const s=setup(); const support=s.env.CopilotAudioCapture.tabSupport;
  for(const userAgent of ['Mozilla Chrome/145.0 Android','Mozilla Version/19.0 Safari/605','Mozilla Chrome/134.0']) {
    assert.equal(support({...s.env,navigator:{...s.env.navigator,userAgent}}).supported,false);
  }
  assert.equal(support(s.env).supported,true);
});
test('direct audio transcript provenance is accepted by the protected ingestion schema', () => {
  assert.ok(segmentSchema.safeParse({id:randomUUID(),source:'tab-audio',text:'A captured statement',capturedAt:new Date().toISOString()}).success);
});
test('transcription timeout tolerates 30 seconds and 14 minutes, then stops after 15 minutes', async () => {
  const active=setup({voiced:true}); await active.capture.startTab(false);
  for(let i=0;i<220;i++) active.tick();
  assert.equal(active.errors.length,0); assert.ok(active.capture.run);
  for(let i=220;i<5600;i++) active.tick();
  assert.equal(active.errors.length,0); assert.ok(active.capture.run);
  for(let i=5600;i<6010;i++) active.tick();
  assert.match(active.errors[0],/no speech text for 15 minutes/); assert.equal(active.capture.run,null); assert.ok(active.tab.stopped);
  const quiet=setup(); await quiet.capture.startTab(false);
  for(let i=0;i<6010;i++) quiet.tick();
  assert.equal(quiet.errors.length,0); assert.ok(quiet.capture.run); await quiet.capture.stop();
});
test('unbroken speech publishes a labelled draft, then a correction with the same utterance identity', async () => {
  const s=setup(); await s.capture.startTab(false);
  const result=(text: string,final: boolean)=>s.recognizer.onresult({resultIndex:0,results:[Object.assign([{transcript:text}],{isFinal:final})]});
  result('The card seems broken',false); for(let i=0;i<55;i++)s.tick();
  assert.equal(s.finals.length,1); assert.equal(s.finals[0].provisional,true);
  for(let i=0;i<55;i++)s.tick(); assert.equal(s.finals.length,1,'unchanged draft is not resent');
  result('The cart seems broken',true);
  assert.equal(s.finals[1].provisional,false); assert.equal(s.finals[1].utteranceId,s.finals[0].utteranceId);
  await s.capture.stop();
});
test('report view keeps the final correction, even if an older draft arrives later', () => {
  const make=(text: string,provisional: boolean,second: number): Segment=>({id:randomUUID(),source:'tab-audio',text,provisional,utteranceId:'passage-1',capturedAt:`2026-09-10T08:00:0${second}.000Z`});
  const final=make('cart',false,2);
  assert.deepEqual(latestTranscript([make('card',true,1),final,make('card',true,3)]),[final]);
});

test('refresh snapshot retains short unfinished speech as a draft without repeating it', async () => {
  const s=setup(); await s.capture.startTab(true);
  s.recognizer.onresult({resultIndex:0,results:[Object.assign([{transcript:'Yes, next'}],{isFinal:false})]});
  s.capture.snapshot(); s.capture.snapshot();
  assert.equal(s.finals.length,1); assert.equal(s.finals[0].value,'Yes, next');
  assert.equal(s.finals[0].provisional,true);
  s.recognizer.onresult({resultIndex:0,results:[Object.assign([{transcript:'Yes, next week.'}],{isFinal:true})]});
  assert.equal(s.finals[1].utteranceId,s.finals[0].utteranceId);
  assert.equal(s.finals[1].provisional,false); await s.capture.stop();
});
test('capture failure saves the last unfinished speech before releasing audio', async () => {
  const s=setup(); await s.capture.startTab(true);
  s.recognizer.onresult({resultIndex:0,results:[Object.assign([{transcript:'We should check this'}],{isFinal:false})]});
  s.recognizer.onerror({error:'network'});
  assert.equal(s.finals.length,1); assert.equal(s.finals[0].provisional,true);
  assert.equal(s.capture.run,null); assert.ok(s.mic.stopped && s.tab.stopped);
});

test('ongoing speech becomes a provisional update within two seconds',async()=>{
  const s=setup();await s.capture.startTab(true);
  s.recognizer.onresult({resultIndex:0,results:[Object.assign([{transcript:'What should we clarify next?'}],{isFinal:false})]});
  for(let i=0;i<13;i++)s.tick();assert.equal(s.finals.length,0);
  s.tick();assert.equal(s.finals.length,1);assert.equal(s.finals[0].provisional,true);
  await s.capture.stop();
});
