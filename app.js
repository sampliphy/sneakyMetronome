'use strict';
const $ = id => document.getElementById(id);
const controls = { tempo: $('tempo'), range: $('tempo-range'), omissions: $('omissions'), measures: $('measures'), visual: $('visual'), accent: $('accent') };
let signature = 4, playing = false, starting = false, context, timer, nextTick = 0, position = 0, countIn = true, silent = new Set(), generation = 0;
let audioNodes = new Set(), visualTimers = new Set();
const bounded = (value, min, max, fallback) => Number.isFinite(Number(value)) && value !== '' ? Math.min(max, Math.max(min, Math.round(Number(value)))) : fallback;
function configuration() {
  const tempo = bounded(controls.tempo.value, 30, 240, 90);
  const measures = Number(controls.measures.value);
  const total = signature * measures;
  return { tempo, total, omissions: bounded(controls.omissions.value, 0, total, 0) };
}
function update() {
  const config = configuration();
  controls.tempo.value = controls.range.value = config.tempo;
  controls.omissions.max = config.total;
  controls.omissions.value = config.omissions;
  $('tempo-unit').textContent = signature === 4 ? 'BPM · NOIRE' : 'BPM · NOIRE POINTÉE';
  $('pattern-summary').textContent = `${config.omissions} tic${config.omissions > 1 ? 's' : ''} silencieux sur ${config.total}, répartis au hasard à chaque cycle.`;
  $('beats').replaceChildren(...Array.from({ length: signature }, (_, i) => {
    const beat = document.createElement('span');
    beat.className = 'beat' + (i === 0 ? ' first' : '');
    beat.setAttribute('aria-hidden', 'true');
    return beat;
  }));
  $('beat-caption').textContent = controls.visual.checked ? 'Les repères restent visibles, même pendant les tics silencieux.' : 'Une mesure de départ, puis faites confiance à votre oreille.';
}
function randomPattern(total, omissions) {
  const indices = Array.from({ length: total }, (_, i) => i);
  for (let i = total - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return new Set(indices.slice(0, omissions));
}
function clickAt(time, beat) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = controls.accent.checked && beat === 0 ? 1400 : 950;
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(.32, time + .002);
  gain.gain.exponentialRampToValueAtTime(.001, time + .04);
  oscillator.connect(gain).connect(context.destination);
  audioNodes.add(oscillator);
  oscillator.onended = () => { audioNodes.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
  oscillator.start(time);
  oscillator.stop(time + .045);
}
function scheduleVisual(time, beat, isCountIn, token) {
  const timeout = setTimeout(() => {
    visualTimers.delete(timeout);
    if (!playing || generation !== token) return;
    $('status').textContent = isCountIn ? 'Mesure de départ' : 'À vous de garder le rythme';
    [...$('beats').children].forEach((element, index) => element.classList.toggle('active', (controls.visual.checked || isCountIn) && index === beat));
  }, Math.max(0, (time - context.currentTime) * 1000));
  visualTimers.add(timeout);
}
function schedule() {
  if (!playing) return;
  const config = configuration();
  while (nextTick < context.currentTime + .1) {
    if (!countIn && position === 0) silent = randomPattern(config.total, config.omissions);
    const beat = position % signature;
    if (countIn || !silent.has(position)) clickAt(nextTick, beat);
    scheduleVisual(nextTick, beat, countIn, generation);
    nextTick += 60 / config.tempo / (signature === 6 ? 3 : 1);
    position++;
    if (countIn && position === signature) { countIn = false; position = 0; }
    else if (!countIn && position >= config.total) position = 0;
  }
}
function stop() {
  playing = false;
  generation++;
  clearInterval(timer);
  visualTimers.forEach(clearTimeout);
  visualTimers.clear();
  audioNodes.forEach(node => { try { node.stop(); } catch {} });
  audioNodes.clear();
  $('play-label').textContent = 'Commencer';
  $('play-icon').textContent = '▶';
  $('play').setAttribute('aria-pressed', 'false');
  $('status').textContent = 'Prêt à jouer';
  [...$('beats').children].forEach(beat => beat.classList.remove('active'));
}
async function start() {
  if (starting) return;
  starting = true;
  $('play').disabled = true;
  $('error').hidden = true;
  const token = generation;
  try {
    context ??= new (window.AudioContext || window.webkitAudioContext)();
    await context.resume();
    if (token !== generation) return;
    update();
    playing = true;
    countIn = true;
    position = 0;
    nextTick = context.currentTime + .08;
    $('play-label').textContent = 'Arrêter';
    $('play-icon').textContent = '■';
    $('play').setAttribute('aria-pressed', 'true');
    schedule();
    timer = setInterval(schedule, 25);
  } catch {
    stop();
    $('error').textContent = 'Le son ne peut pas démarrer. Réessayez dans un navigateur récent.';
    $('error').hidden = false;
  } finally { starting = false; $('play').disabled = false; }
}
function changeSettings() {
  const wasPlaying = playing;
  stop();
  update();
  if (wasPlaying) start();
}
$('play').addEventListener('click', () => playing ? stop() : start());
controls.tempo.addEventListener('change', changeSettings);
controls.range.addEventListener('input', () => { controls.tempo.value = controls.range.value; changeSettings(); });
for (const [id, amount] of [['slower', -1], ['faster', 1]]) $(id).addEventListener('click', () => { controls.tempo.value = configuration().tempo + amount; changeSettings(); });
for (const control of [controls.omissions, controls.measures]) control.addEventListener('change', changeSettings);
controls.visual.addEventListener('change', update);
document.querySelectorAll('[data-signature]').forEach(button => button.addEventListener('click', () => {
  signature = Number(button.dataset.signature);
  document.querySelectorAll('[data-signature]').forEach(item => { const selected = item === button; item.classList.toggle('selected', selected); item.setAttribute('aria-pressed', String(selected)); });
  changeSettings();
}));
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.repeat || /^(INPUT|SELECT|BUTTON|TEXTAREA|A)$/.test(event.target.tagName)) return;
  event.preventDefault();
  playing ? stop() : start();
});
// A background tab can throttle timers. Stop rather than play late bursts on return.
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
window.addEventListener('pagehide', stop);
update();
