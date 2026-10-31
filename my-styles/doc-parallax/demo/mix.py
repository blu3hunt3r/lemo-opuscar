"""Endurance v2: the soundtrack (score + place + design, no voice) → out/mix.wav (48 kHz stereo, exactly events.json `dur` long).

Every cue time comes from events.json (exported from story.js EVENTS): the score and the design are written against named
anchors (the flash, the crack, the shatter, the whiteouts, the wave's rise and break, the route, the silence, the hits),
so a retimed picture moves the sound with it.

Bigger than v1, still a documentary: the weight comes from physical sound (subs with harmonics, close detail, wide fields)
and from density at three peaks, not from trailer gestures (no braaam, no long risers, no reverse cymbals).

Score (original; D minor → D major; low strings, horns, low brass at the peaks, piano, timpani / bass drum; built by
register and density):
  flash      no score: a whisper of wind, then one burst (Hurley's 25 charges of flash powder fired at once); a low swell
             on D blooms out of it and hangs
  colour     the score lands on the flash cut: low strings on D, the piano's low octave, Dm(add9) opening upward;
             the motif D–E–F–A (falls to the low A, left hanging); the dominant (A) trembles under the cracks
  shatter    PEAK 1: the roll-less hit lands a semitone up, on Bb (deceptive): strings, horns, low brass, timpani, bass drum
  wreck      a deep cello tremolo (bowed strokes) Bb → Gm, contrabass under it; A again in the gust
  sinking    dark: low D (contrabass + cellos), one low piano note; the line falls with her (D → C → Bb) and dies away
  launch     the build starts: a spiccato pulse on D (113 BPM, 16 beats from the launch to the wave), a pedal D,
             Dm → Bb/D, the violins' tremolo enters with the storm
  storm      Gm/D with horns and trombones, timpani on the beats, then A/D with the violins climbing to A5, sixteenths,
             a timpani roll into the break
  wave       PEAK 2 (the biggest): D minor tutti on the whiteout (stabs + sustains + timpani + bass drum + tam-tam),
             then the roar cuts and the tail rings into the room
  route      a ghost of the pulse (pizzicato D) and the motif high on the piano, landing on D with the route
  silence    the score stops dead and stays out (music bus = exact zero) until the red pen underlines "Marooned"
  beach      one low piano note on the underline, the strings breathe in with the paper's white, Dsus2 under the sea,
             a soft roll under the count; PEAK 3: the 28 lands on D major (horns on the third), the motif rises
             D–E–F#–A and rings out under the fade
Place + design: all synthesised here (numpy/scipy): night wind and spindrift, the flash burst (25 staggered pops, a deep
whoomph, a long fizz, sparks), the low swell, ice cracks racing across the field, the plate-ice break (glass modes, crunch, boom), falling
shards, timber groans, rigging creaks, the long falling moan of the sinking, ice grinding, the blizzard, surf and
shingle, wood knocks and oars, the storm sea, the giant wave's sub swell and roar, the wave hit, room tone and lamp
hum, pen nibs, paper, type and counter ticks, the hits.

Run from the library root:  .venv/bin/python films/endurance-v2/mix.py      (env: LIB = library root, OUT = output dir)
Writes out/mix.wav, out/stems/{music,place,fx}.wav (with the master gain and the safety limiter's gain: they sum to
the mix), out/mix_check.png (loudness + stems over time) and out/mix_spectrogram.png, then prints the checks.
"""
import os, sys, json, time, zlib, subprocess, re
T_START = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get('LIB') or os.path.abspath(os.path.join(HERE, '..', '..'))   # the library
sys.path.insert(0, ROOT)
import numpy as np, soundfile as sf
from scipy.signal import stft, istft, lfilter, resample_poly, fftconvolve
from scipy.ndimage import uniform_filter1d, maximum_filter1d, minimum_filter1d
from core.audio.sfx import SR, bp, lp, hp, add
from core.audio import sampler as S

OUT = os.environ.get('OUT') or os.path.join(HERE, 'out')
os.makedirs(os.path.join(OUT, 'stems'), exist_ok=True)

# ═══════════════════════════════ PARAMETERS ═══════════════════════════════
SEED = 1915                    # the year the ice took her
TARGET_I = -16.0               # LUFS integrated (mux.sh then brings it to −14 with a linear loudnorm)
TP_MAX = -1.5                  # dBTP absolute ceiling
PLR_MAX = 12.5                 # dB: true peak − loudness allowed, so mux's loudnorm stays LINEAR (its limit is 12.8)

# bus balance (dB, before the master normalisation)
G_STRINGS, G_BRASS, G_PIANO, G_PERC = -5.0, -6.0, -4.0, -3.0
G_MUSIC, G_PLACE, G_FX = 0.0, 0.0, 0.0
VERB = dict(size=.5, mix=.22)  # the hall on the music (sampler.room)
SUS_REF, PIANO_REF, LEVEL_SLOPE = -28.0, -30.0, 30.0   # dBFS at vel .45 (sustains) / .30 (piano); dB per decade of vel
SIL_FADE = .08                 # s: the score stops dead into the silence (fade length before it starts)
END_FADE = .45                 # s, master fade at the very end

# ═══════════════════════════════ EVENTS ═══════════════════════════════
E = json.load(open(os.path.join(HERE, 'events.json')))
DUR = float(E['dur']); EV = E['ev']
N = int(round(DUR * SR))
TT = np.arange(N) / SR
def ev(ty): return sorted((e for e in EV if e['type'] == ty), key=lambda e: e['t'])
def one(ty):
    L = ev(ty); assert len(L) == 1, f'expected one {ty!r} event, got {len(L)}'; return L[0]
FLASH = one('flash')           # one burst: Hurley's 25 charges of flash powder, wired together and fired at once
W = [e['t'] for e in ev('whiteout')]; assert len(W) == 5, 'expected five whiteouts'
GUST = ev('gust'); assert len(GUST) == 2
for g, w in zip(GUST, W[:2]): assert abs(g['t'] + g['dur'] - w) < 1e-6, 'a gust must end on its whiteout'
SPRAY, BRK, SWL = one('spray'), one('break'), one('swell')
assert abs(SPRAY['t'] + SPRAY['dur'] - W[2]) < 1e-6 and abs(BRK['t'] + BRK['dur'] - W[3]) < 1e-6 and abs(SWL['t'] + SWL['dur'] - W[4]) < 1e-6
CRK, SHT = one('crack'), one('shatter'); assert abs(CRK['t'] + CRK['dur'] - SHT['t']) < 1e-6
HITS = ev('hit'); H_SOFT = [h for h in HITS if h.get('level') == 'soft'][0]; H_LOW = [h for h in HITS if h.get('level') == 'low'][0]
TYPES, COUNTS = ev('type'), ev('count'); assert len(COUNTS) == 3
SIL, ROUTE, SINK, GROAN, RISE, SLIDE, PEN, FADE, CUT = (one(k) for k in ('silence', 'route', 'sink', 'groan', 'rise', 'slide', 'pen', 'fade', 'cut'))
A = {'start': 0., 'end': DUR, 'flash': FLASH['t'], 'cut': CUT['t'], 'count1': COUNTS[0]['t'],
     'crack': CRK['t'], 'shatter': SHT['t'], 'shEnd': SHT['t'] + SHT['dur'], 'groan': GROAN['t'], 'groanEnd': GROAN['t'] + GROAN['dur'],
     'g1': GUST[0]['t'], 'w1': W[0], 'sink': SINK['t'], 'sinkEnd': SINK['t'] + SINK['dur'], 'g2': GUST[1]['t'], 'w2': W[1],
     'spray': SPRAY['t'], 'w3': W[2], 'rise': RISE['t'], 'riseEnd': RISE['t'] + RISE['dur'], 'brk': BRK['t'], 'wave': W[3],
     'route': ROUTE['t'], 'routeEnd': ROUTE['t'] + ROUTE['dur'], 'hit1': H_SOFT['t'], 'sil': SIL['t'], 'silEnd': SIL['t'] + SIL['dur'],
     'slide': SLIDE['t'], 'slideEnd': SLIDE['t'] + SLIDE['dur'], 'pen': PEN['t'], 'penEnd': PEN['t'] + PEN['dur'], 'swell': SWL['t'],
     'w5': W[4], 'count3': COUNTS[2]['t'], 'hit2': H_LOW['t'], 'fade': FADE['t'], 'fadeEnd': FADE['t'] + FADE['dur']}
def T(a, o=0.): return A[a] + o
BEAT = (A['wave'] - A['w2']) / 16          # the build: 16 beats from the launch's whiteout to the wave (≈113 BPM)
def bt(k): return ('w2', k * BEAT)

# ═══════════════════════════════ HELPERS ═══════════════════════════════
def sec(d): return int(round(d * SR))
def tv(n): return np.arange(n) / SR
def dbl(d): return 10 ** (np.asarray(d, float) / 20)
def rms(x): return float(np.sqrt(np.mean(np.square(x)))) if len(x) else 0.
def unit(x): m = np.abs(x).max(); return x / m if m > 0 else x
def urms(x, mask=None):
    r = rms(x if mask is None else x[mask]); return x / r if r > 0 else x
def R(name): return np.random.default_rng([SEED, zlib.crc32(name.encode())])
def curve(points, t):
    P = sorted((T(a, o), v) for a, o, v in points); return np.interp(t, [p[0] for p in P], [p[1] for p in P])
def edges(n, a, b):
    e = np.ones(n); i, j = min(n, sec(a)), min(n, sec(b))
    if i: e[:i] = np.sin(np.linspace(0, np.pi / 2, i)) ** 2
    if j: e[n - j:] *= np.cos(np.linspace(0, np.pi / 2, j)) ** 2
    return e
EASE = {'ss': lambda u: u * u * (3 - 2 * u), 'eo': lambda u: 1 - (1 - u) ** 3, 'ei': lambda u: u ** 3,
        'eio': lambda u: np.where(u < .5, 4 * u ** 3, 1 - (-2 * u + 2) ** 3 / 2)}
INV = {'eo': lambda k: 1 - (1 - k) ** (1 / 3), 'eio': lambda k: np.where(k < .5, (k / 4) ** (1 / 3), 1 - (2 * (1 - k)) ** (1 / 3) / 2)}
def speed(name, u):
    k = EASE[name](np.clip(u, 0, 1)); s = np.gradient(k, u); return np.clip(s / s.max(), 0, 1)
def bus(): return np.zeros((N, 2))
def put(b, x, t, g_db=0., pan=0.): add(b, np.asarray(x, float), t, float(dbl(g_db)), pan)
def put2(b, x2, t, g_db=0.):
    s = sec(t); e = min(N, s + len(x2))
    if s < 0: x2 = x2[-s:]; s = 0
    if e > s: b[s:e] += x2[:e - s] * dbl(g_db)
def soft(x, drive):
    """soft clipper on a unit-peak signal: rounds the peaks, keeps the body (more weight per dB of true peak)"""
    return np.tanh(drive * x) / np.tanh(drive)
def stereo(fn, name):
    """two decorrelated renderings of the same sound (same design, other seeds) → (n, 2)"""
    a, b = fn(R(name + 'L')), fn(R(name + 'R')); n = min(len(a), len(b)); return np.stack([a[:n], b[:n]], 1)

def kernels(r, k, lo, hi, ms):
    out = []
    for i in range(k):
        L = max(8, sec(ms[i % len(ms)] / 1000)); g = bp(r.standard_normal(L + 512), lo, hi)[512:] * np.hanning(L)
        out.append(g / (np.abs(g).max() + 1e-12))
    return out
def glass_kernels(r, k, lo, hi, tau=(.012, .07), modes=4):
    """glassy ice: a click and a few inharmonic plate modes, each its own decay"""
    out = []
    for i in range(k):
        L = sec(.25); t = tv(L)
        g = hp(r.standard_normal(L), 4000) * np.exp(-t / .0004) * .6
        for m in range(modes):
            f = np.exp(r.uniform(np.log(lo), np.log(hi))); g += r.uniform(.4, 1) * np.sin(2 * np.pi * f * t + r.uniform(0, 6.3)) * np.exp(-t / r.uniform(*tau))
        out.append(g / (np.abs(g).max() + 1e-12))
    return out
def crack_kernels(r, k, lo, hi, tau=(.0003, .0012)):
    """ice crack grains: a sharp broadband snap with a short bright ring"""
    out = []
    for i in range(k):
        L = sec(.02); t = tv(L)
        g = hp(r.standard_normal(L), lo) * np.exp(-t / r.uniform(*tau)) + .5 * np.sin(2 * np.pi * r.uniform(lo, hi) * t) * np.exp(-t / r.uniform(.002, .006))
        out.append(g / (np.abs(g).max() + 1e-12))
    return out
def scatter(n, times, amps, ks, r):
    """grains: each of `times` (s) gets one of the kernels, signed, at `amps`"""
    x = np.zeros(n); times = np.asarray(times, float); amps = np.asarray(amps, float)
    ok = (times >= 0) & (times < n / SR); times, amps = times[ok], amps[ok]
    idx = (times * SR).astype(int); which = r.integers(len(ks), size=len(idx)); sg = r.choice([-1., 1.], len(idx))
    for j, kk in enumerate(ks):
        imp = np.zeros(n); sel = which == j; np.add.at(imp, idx[sel], amps[sel] * sg[sel])
        if sel.any(): x += fftconvolve(imp, kk)[:n]
    return x
def scatter2(n, times, amps, pans, ks, name):
    """stereo grains, each panned (equal power); both channels draw the same kernels and signs"""
    pans = np.asarray(pans, float); amps = np.asarray(amps, float)
    gl, gr = np.cos((pans + 1) * np.pi / 4) * 1.414, np.sin((pans + 1) * np.pi / 4) * 1.414
    return np.stack([scatter(n, times, amps * gl, ks, R(name)), scatter(n, times, amps * gr, ks, R(name))], 1)

def tame(x, crest=2.8, knee=4.0, win=.05):
    """a noise bed's crest: identity below knee, then bent smoothly towards crest × its own local RMS (50 ms)"""
    e = np.sqrt(uniform_filter1d(np.square(x), sec(win), axis=0) + 1e-14)
    c = crest * e; a = c * 10 ** (-knee / 20); ax = np.abs(x); o = ax > a; y = x.copy()
    y[o] = np.sign(x[o]) * (a[o] + (c[o] - a[o]) * np.tanh((ax[o] - a[o]) / (c[o] - a[o])))
    return y
NPS, HOP = 2048, 512
def shaped_noise(gain, seed_name):
    """stereo noise whose STFT magnitude is shaped frame by frame: gain(tf, f, ch) → (bins, frames), linear"""
    r = R(seed_name); out = np.zeros((N, 2))
    for c in range(2):
        f, tf, Z = stft(r.standard_normal(N), SR, window='hann', nperseg=NPS, noverlap=NPS - HOP)
        _, x = istft(Z * gain(tf, f, c), SR, window='hann', nperseg=NPS, noverlap=NPS - HOP)
        out[:, c] = x[:N]
    return out
def fwander(r, n, win):
    w = uniform_filter1d(r.standard_normal(n), max(1, int(win))); return w / (w.std() + 1e-12)
def echoes(x, taps):
    """the ice field / the sea throws it back: (delay s, gain, low-pass Hz)"""
    y = x.copy(); n = len(x)
    for dl, g, fc in taps:
        k = sec(dl)
        if k < n: y[k:] += lp(x, fc)[:n - k] * g
    return y

# ═══════════════════════════════ 1. SCORE ═══════════════════════════════
t1 = time.time()
S.seed(SEED)
FAM = {k: bus() for k in ('strings', 'brass', 'piano', 'perc')}
BRASS = ('horn', 'trombone', 'tuba', 'horn_stac', 'trombone_stac', 'tuba_stac')
# sustained notes: (start, end, instrument, pitch, vel, pan, attack s, release s); start/end = (anchor, offset s)
# (violas only from F#3 up: the library's lowest viola samples, C3/D3/E3, sound an octave high; F3 would use E3)
SUS = [
    # colour: the score lands on the flash cut, Dm(add9) opening upward
    (('cut', -.03), ('crack', -.4), 'contrabass', 'D2', .46, .25, .05, .4),
    (('cut', -.03), ('crack', -.4), 'cellos', 'D3', .44, -.2, .07, .4),
    (('cut', .35), ('crack', -.4), 'cellos', 'A2', .36, -.05, .6, .4),
    (('cut', .9), ('crack', -.4), 'cellos', 'F3', .34, .12, .9, .4),
    (('cut', 1.3), ('crack', -.4), 'violins', 'A4', .21, -.3, 1.1, .4),
    (('cut', 1.9), ('crack', -.4), 'violins', 'E5', .18, .3, 1.0, .4),
    # the dominant trembles under the cracks
    (('crack', -.48), ('shatter', 0), 'contrabass', 'A1', .52, .25, .15, .05),
    (('crack', -.48), ('shatter', 0), 'cellos', 'A2', .5, -.2, .15, .05),
    (('crack', -.48), ('shatter', 0), 'cellos', 'E3', .46, .1, .15, .05),
    (('crack', -.48), ('shatter', 0), 'violins_trem', 'A4', .4, -.3, .2, .05),
    (('crack', -.48), ('shatter', 0), 'violins_trem', 'C#5', .4, .3, .2, .05),
    (('crack', -.4), ('shatter', 0), 'violins_trem', 'E5', .36, 0, .25, .05),
    # PEAK 1, the shatter: Bb (a semitone up from the A: the floor gives way)
    (('shatter', 0), ('shatter', 1.4), 'contrabass', 'Bb1', .68, .25, .006, .9),
    (('shatter', 0), ('shatter', 1.4), 'cellos', 'Bb2', .64, -.2, .006, .9),
    (('shatter', 0), ('shatter', 1.0), 'cellos', 'F3', .6, .1, .006, .8),
    (('shatter', 0), ('shatter', .9), 'violas', 'Bb3', .56, -.1, .006, .8),
    (('shatter', 0), ('shatter', .9), 'violins', 'D5', .5, -.3, .006, .8),
    (('shatter', 0), ('shatter', .9), 'violins', 'F5', .48, .3, .006, .8),
    (('shatter', 0), ('shatter', .55), 'horn', 'F3', .62, -.15, .008, .9),
    (('shatter', 0), ('shatter', .55), 'horn', 'Bb3', .62, .15, .008, .9),
    (('shatter', 0), ('shatter', .55), 'horn', 'D4', .58, 0, .008, .9),
    (('shatter', 0), ('shatter', .5), 'trombone', 'Bb2', .6, -.1, .008, .8),
    (('shatter', 0), ('shatter', .5), 'tuba', 'Bb1', .62, .1, .008, .8),
    # wreck: contrabass under the cello tremolo (TREM), A again in the gust
    (('shatter', 1.25), ('groan', 1.15), 'contrabass', 'Bb1', .46, .25, .5, .3),
    (('groan', 1.05), ('g1', 0), 'contrabass', 'G1', .48, .25, .3, .25),
    (('g1', -.05), ('w1', 0), 'contrabass', 'A1', .52, .25, .15, .08),
    (('g1', -.05), ('w1', 0), 'cellos', 'A2', .5, -.2, .15, .08),
    (('g1', -.05), ('w1', 0), 'cellos', 'E3', .46, .1, .15, .08),
    # sinking: dark low D; the line falls with her and dies away
    (('w1', 0), ('sink', 1.75), 'contrabass', 'D2', .5, .25, .05, .5),
    (('w1', 0), ('sink', 1.75), 'cellos', 'D2', .46, -.25, .05, .5),
    (('w1', .3), ('sink', 1.75), 'cellos', 'A2', .4, .1, .6, .5),
    (('sink', 1.7), ('sink', 2.3), 'contrabass', 'C2', .48, .25, .1, .3),
    (('sink', 2.25), ('sinkEnd', -.15), 'contrabass', 'Bb1', .46, .25, .1, .5),
    (('sink', 1.7), ('sink', 2.3), 'cellos', 'G2', .42, .1, .1, .3),
    (('sink', 2.25), ('sinkEnd', -.15), 'cellos', 'F2', .42, .1, .1, .5),
    (('sink', 1.7), ('sinkEnd', -.15), 'cellos', 'D3', .36, -.25, .3, .5),
    # the build: a pedal D under Dm → Bb → Gm → A, rising in register; the brass come in with the storm and the wave
    (bt(-.25), ('wave', 0), 'contrabass', 'D2', .44, .25, .6, .03),
    (bt(0), bt(4), 'violas', 'A3', .32, -.15, .7, .25),
    (bt(0), bt(8), 'cellos', 'F3', .3, .15, .9, .2),
    (bt(4), bt(8), 'violas', 'Bb3', .36, -.15, .25, .2),
    (('w3', -.03), bt(8), 'violins_trem', 'Bb4', .3, -.3, .3, .2),
    (('w3', -.03), bt(8), 'violins_trem', 'D5', .3, .3, .3, .2),
    (bt(8), bt(12), 'cellos', 'G2', .44, -.2, .15, .2),
    (bt(8), bt(12), 'cellos', 'D3', .42, .15, .15, .2),
    (bt(8), bt(12), 'violas', 'Bb3', .4, -.15, .15, .2),
    (bt(8), bt(12), 'violins_trem', 'G4', .38, -.3, .15, .2),
    (bt(8), bt(12), 'violins_trem', 'D5', .38, .3, .15, .2),
    (bt(8), bt(12), 'horn', 'D4', .34, -.15, .6, .2),
    (bt(8), bt(12), 'horn', 'Bb3', .34, .15, .6, .2),
    (('rise', 0), bt(12), 'trombone', 'G2', .36, -.1, .8, .2),
    (('rise', 0), bt(12), 'trombone', 'D3', .34, .1, .8, .2),
    (bt(12), ('wave', 0), 'cellos', 'A2', .52, -.2, .1, .03),
    (bt(12), ('wave', 0), 'cellos', 'E3', .5, .15, .1, .03),
    (bt(12), ('wave', 0), 'violas', 'C#4', .46, -.15, .1, .03),
    (bt(12), ('wave', 0), 'violins_trem', 'A4', .46, -.3, .1, .03),
    (bt(12), ('wave', 0), 'violins_trem', 'C#5', .46, .3, .1, .03),
    (bt(12), ('wave', 0), 'violins_trem', 'E5', .44, 0, .1, .03),
    (bt(14), ('wave', 0), 'violins_trem', 'A5', .44, .2, .25, .03),
    (bt(12), ('wave', 0), 'horn', 'C#4', .44, -.15, .15, .03),
    (bt(12), ('wave', 0), 'horn', 'E4', .42, .15, .15, .03),
    (bt(12), ('wave', 0), 'horn', 'A3', .44, 0, .15, .03),
    (bt(12), ('wave', 0), 'trombone', 'A2', .46, -.1, .15, .03),
    (bt(12), ('wave', 0), 'trombone', 'E3', .44, .1, .15, .03),
    (bt(12), ('wave', 0), 'tuba', 'D2', .46, 0, .3, .03),
    # PEAK 2, the wave: D minor tutti, held a moment, then let ring in the hall
    (('wave', 0), ('wave', .8), 'contrabass', 'D2', .62, .25, .005, 1.2),
    (('wave', 0), ('wave', .8), 'cellos', 'D2', .6, -.25, .005, 1.1),
    (('wave', 0), ('wave', .8), 'cellos', 'A2', .68, .1, .005, 1.1),
    (('wave', 0), ('wave', .8), 'cellos', 'F3', .66, -.1, .005, 1.1),
    (('wave', 0), ('wave', .8), 'violas', 'A3', .64, -.15, .005, 1.0),
    (('wave', 0), ('wave', .8), 'violas', 'D4', .64, .15, .005, 1.0),
    (('wave', 0), ('wave', .8), 'violins', 'D5', .62, 0, .005, 1.0),
    (('wave', 0), ('wave', .8), 'violins', 'F5', .62, .3, .005, 1.0),
    (('wave', 0), ('wave', .8), 'violins', 'A5', .6, -.3, .005, 1.0),
    (('wave', 0), ('wave', .7), 'horn', 'A3', .66, 0, .006, 1.0),
    (('wave', 0), ('wave', .7), 'horn', 'D4', .66, -.15, .006, 1.0),
    (('wave', 0), ('wave', .7), 'horn', 'F4', .64, .15, .006, 1.0),
    (('wave', 0), ('wave', .7), 'trombone', 'A2', .66, .1, .006, .9),
    (('wave', 0), ('wave', .7), 'trombone', 'D3', .66, -.1, .006, .9),
    (('wave', 0), ('wave', .7), 'tuba', 'D2', .7, 0, .006, 1.0),
    (('wave', 0), ('wave', .7), 'tuba', 'D1', .55, 0, .006, 1.0),
    # route: thin and open (D, A, E: no third), stopping on the route's landing
    (('route', 0), ('hit1', 0), 'cellos', 'D3', .3, -.15, .8, .08),
    (('route', 1.0), ('hit1', 0), 'cellos', 'A2', .28, .15, .8, .08),
    (('route', .3), ('hit1', 0), 'violins', 'A4', .2, -.3, 1.0, .08),
    (('route', .9), ('hit1', 0), 'violins', 'E5', .17, .3, 1.2, .08),
    # the return: a low D under "Marooned", the strings breathe in with the paper's white
    (('pen', 0), ('w5', .05), 'contrabass', 'D2', .42, .25, .8, .3),
    (('pen', .3), ('w5', .05), 'cellos', 'D3', .34, -.2, 1.0, .3),
    (('swell', -.35), ('w5', .1), 'cellos', 'A2', .36, -.2, .6, .3),
    (('swell', -.1), ('w5', .1), 'violas', 'A3', .34, .1, .5, .3),
    # beach: Dsus2 under the sea (neither minor nor major yet)
    (('w5', 0), ('hit2', -.05), 'contrabass', 'D2', .48, .25, .25, .07),
    (('w5', 0), ('hit2', -.05), 'cellos', 'A2', .44, -.2, .25, .07),
    (('w5', 0), ('hit2', -.05), 'cellos', 'D3', .42, .1, .25, .07),
    (('w5', .2), ('hit2', -.05), 'violas', 'A3', .36, -.1, .6, .07),
    (('w5', .4), ('hit2', -.05), 'violins', 'E5', .24, .3, .8, .07),
    (('w5', .5), ('hit2', -.05), 'violins', 'A4', .26, -.3, .8, .07),
    # PEAK 3, the 28: D major blooms, horns on the third
    (('hit2', 0), ('fade', .3), 'contrabass', 'D2', .5, .25, .04, 1.4),
    (('hit2', 0), ('fade', .3), 'cellos', 'D3', .54, -.2, .06, 1.4),
    (('hit2', 0), ('fade', .3), 'cellos', 'A3', .5, -.1, .12, 1.4),
    (('hit2', 0), ('fade', .3), 'violas', 'F#3', .5, .1, .15, 1.4),
    (('hit2', 0), ('fade', .3), 'violas', 'D4', .46, .15, .2, 1.4),
    (('hit2', 0), ('fade', .3), 'violins', 'A4', .42, -.3, .3, 1.4),
    (('hit2', 0), ('fade', .3), 'violins', 'D5', .4, 0, .35, 1.4),
    (('hit2', 0), ('fade', .3), 'violins', 'F#5', .42, .3, .4, 1.4),
    (('hit2', .03), ('fade', .1), 'horn', 'A3', .44, 0, .2, 1.2),
    (('hit2', .03), ('fade', .1), 'horn', 'D4', .44, .15, .2, 1.2),
    (('hit2', .03), ('fade', .1), 'horn', 'F#4', .46, -.15, .2, 1.2),
]
# the deep cello tremolo in the wreck: (start, end, pitch, vel, pan, attack, release, strokes/s)
TREM = [(('shatter', .45), ('groan', 1.15), 'Bb2', .52, -.25, .5, .3, 10.5), (('shatter', .5), ('groan', 1.15), 'F3', .46, .15, .6, .3, 11.3),
        (('groan', 1.05), ('g1', 0), 'G2', .54, -.25, .2, .25, 11.0), (('groan', 1.05), ('g1', 0), 'D3', .48, .15, .2, .25, 11.7)]
# short stabs that give the peaks their attack: (at, instrument, pitch, vel, pan, dB)
STABS = [(('shatter', 0), 'horn_stac', 'Bb3', .8, -.1, -2), (('shatter', 0), 'horn_stac', 'F3', .8, .1, -2),
         (('shatter', 0), 'trombone_stac', 'Bb2', .8, 0, -2), (('shatter', 0), 'tuba_stac', 'Bb1', .8, 0, -1),
         (('shatter', 0), 'cellos_spic', 'Bb2', .9, -.2, 0), (('shatter', 0), 'contrabass_pizz', 'Bb1', .9, .2, 2),
         (('wave', 0), 'horn_stac', 'D4', .95, -.15, 0), (('wave', 0), 'horn_stac', 'A3', .95, .15, 0), (('wave', 0), 'horn_stac', 'F4', .9, 0, -1),
         (('wave', 0), 'trombone_stac', 'D3', .95, -.1, 0), (('wave', 0), 'trombone_stac', 'A2', .95, .1, 0),
         (('wave', 0), 'tuba_stac', 'D2', .95, 0, 1), (('wave', 0), 'cellos_spic', 'D3', 1., .2, 0),
         (('hit2', 0), 'cellos_pizz', 'D3', .8, -.2, 0), (('hit2', 0), 'cellos_pizz', 'A3', .75, .15, -2), (('hit2', 0), 'contrabass_pizz', 'D2', .75, .2, -1)]
# piano (Salamander): (at, pitch, held s, vel, pan)
PIANO = [
    (('cut', 0), 'D1', 3.0, .42, -.1), (('cut', 0), 'D2', 3.0, .38, -.1),        # the score lands on the flash cut
    (('count1', .8), 'D4', 1.5, .3, 0), (('count1', 1.25), 'E4', 1.5, .31, 0), (('count1', 1.7), 'F4', 1.6, .33, .05),
    (('count1', 2.3), 'A3', 1.6, .3, -.05),                                     # the motif falls to the low A, unresolved
    (('shatter', 0), 'Bb0', 2.0, .55, -.1), (('shatter', 0), 'Bb1', 2.0, .5, -.1),
    (('sink', 0), 'D1', 3.0, .44, -.1),                                          # she's going: a single low note
    (('wave', 0), 'D1', 2.2, .52, -.1), (('wave', 0), 'D2', 2.2, .46, -.1),
    (('route', .85), 'D5', 1.0, .25, .12), (('route', 1.4), 'E5', 1.0, .26, .12), (('route', 1.95), 'F5', 1.0, .28, .12),
    (('route', 2.5), 'E5', 1.0, .26, .12), (('hit1', 0), 'D5', .6, .3, .12),       # the motif high over the route, lands on D
    (('pen', 0), 'D1', 2.6, .48, -.1), (('pen', 0), 'D2', 2.6, .4, -.1),                                            # "Marooned": the first sound after the silence
    (('hit2', 0), 'D1', 3.2, .42, -.1), (('hit2', 0), 'D2', 3.2, .42, -.1),
    (('hit2', .55), 'D4', 2.8, .3, 0), (('hit2', 1.1), 'E4', 2.6, .31, 0), (('hit2', 1.65), 'F#4', 2.4, .33, 0),
    (('hit2', 2.25), 'A4', 2.2, .34, .05),                                      # the motif rises to the fifth: resolved
]
# string fader ride (anchor, offset s, dB): swells into each peak, dies with the ship, the long crescendo of the build
STR_RIDE = [('start', 0, 2), ('cut', 0, 2), ('crack', -.5, 1), ('shatter', -.03, 1), ('shatter', .02, 1), ('shatter', .4, 1), ('shatter', 1.0, 0),
            ('groan', 0, 0), ('g1', 0, 0), ('w1', -.03, 2), ('w1', .3, 0), ('sink', 1.6, 1), ('sink', 2.3, -1),
            ('sinkEnd', -.25, -8), ('sinkEnd', .1, -40), ('w2', -.3, -40), ('w2', -.15, -3), ('w3', 0, -1.5), ('rise', 0, -2),
            ('brk', 0, -2.5), ('wave', -.07, -2.5), ('wave', -.006, -4), ('wave', .004, 0), ('wave', .7, -1), ('route', 0, 0), ('hit1', 0, 0),
            ('pen', 0, 0), ('w5', 0, 0), ('count3', 0, .5), ('hit2', -.03, 1.5), ('hit2', .8, 3), ('fade', 0, 2.5), ('end', 0, 1)]
PULSE = dict(v0=.28, v1=.78, acc=.08, from16=12)   # spiccato pulse: velocity ramp, beat accent, sixteenths from this beat
ROUTE_PULSE = 6                # pizzicato ghosts of the pulse over the route

def levelled(x, a, b, target):
    seg_ = x[sec(a):max(sec(a) + sec(.2), sec(b))]; return x * dbl(target) / (rms(seg_) + 1e-12)
for (a0, a1, inst, p, vel, pan, att, rel) in SUS:
    t0, te = T(*a0), T(*a1); d = te - t0
    x = levelled(S.note(inst, p, d, vel, release=rel, attack=att), att if d - att > .3 else 0, d, SUS_REF + LEVEL_SLOPE * np.log10(vel / .45))
    put(FAM['brass' if inst in BRASS else 'strings'], x, t0, 0, pan)
# the tremolo: a sustained cello note re-bowed ~11 times a second (amplitude strokes with a little jitter), plus the
# spiccato bite of every stroke
for (a0, a1, p, vel, pan, att, rel, rate) in TREM:
    t0, te = T(*a0), T(*a1); d = te - t0; rr = R('trem' + p)
    x = S.note('cellos', p, d, vel, release=rel, attack=att); n = len(x)
    ph = np.cumsum(rate * (1 + .07 * fwander(rr, n, sec(.12)))) / SR
    x = x * (.32 + .68 * (.5 - .5 * np.cos(2 * np.pi * ph)) ** .8)
    on = np.nonzero(np.diff(np.floor(ph)) > 0)[0]; bite = S.note('cellos_spic', p, .1, vel * .8)
    bite = bite / (np.abs(bite).max() + 1e-12) * np.abs(x).max() * .35; ed = edges(n, att, rel)
    for i in on:
        k = min(len(bite), n - i)
        if k > 0: x[i:i + k] += bite[:k] * ed[i:i + k]
    put(FAM['strings'], levelled(x, att, d, SUS_REF + LEVEL_SLOPE * np.log10(vel / .45)), t0, 0, pan)
MLOG = []    # (cue, event time, latency of the sample's attack) for the music hits
def putm(fam, x, t, g_db=0., pan=0., tag=None):
    put(FAM[fam], x, t, g_db, pan)
    if tag: ax = np.abs(x); MLOG.append((tag, t, int(np.argmax(ax > .1 * ax.max())) / SR))
for (a, inst, p, vel, pan, g) in STABS:
    x = S.note(inst, p, .5, vel); x = x / (rms(x[:sec(.3)]) + 1e-12) * dbl(SUS_REF)
    putm('brass' if inst in BRASS else 'strings', x, T(*a), g, pan)
for i, (a, p, d, vel, pan) in enumerate(PIANO):
    x = levelled(S.note('piano', p, d, vel), 0, min(1., d), PIANO_REF + LEVEL_SLOPE * np.log10(vel / .3))
    tag = {0: 'piano (flash cut)', 6: 'piano (shatter)', 9: 'piano (wave)', 16: 'piano ("Marooned")', 18: 'piano (28)'}.get(i)
    putm('piano', x, T(*a), 0, pan, tag)

# the pulse of the build: spiccato cellos (eighths, sixteenths in the last bar), pizzicato basses on the beats,
# spiccato violins an octave and more up in the last bar; one crescendo from the launch to the wave
nb = 16; steps = []
for k in range(nb):
    sub = 4 if k >= PULSE['from16'] else 2
    for j in range(sub): steps.append((k + j / sub, j == 0))
for i, (b, on_beat) in enumerate(steps):
    tp = T('w2', b * BEAT); u = b / nb
    v = PULSE['v0'] + (PULSE['v1'] - PULSE['v0']) * u ** 1.3 + (PULSE['acc'] if on_beat else 0)
    put(FAM['strings'], S.note('cellos_spic', 'D3', .22, min(1, v)), tp, 1 + 1.5 * u, -.2)
    if on_beat:
        putm('strings', S.note('contrabass_pizz', 'D2', .5, min(1, v + .05)), tp, 3 + 1 * u, .2, 'pulse 1 (launch)' if b == 0 else None)
    if b >= 12: put(FAM['strings'], S.note('violins_spic', 'D5' if int(b * 4) % 2 == 0 else 'A4', .15, min(1, v * .8)), tp, -10 + 3 * (b - 12) / 4, .3)
# the ghost of the pulse over the route, landing with it
step = ROUTE['dur'] / ROUTE_PULSE
for k in range(ROUTE_PULSE + 1):
    tp = A['route'] + k * step; v = .3 + .25 * k / ROUTE_PULSE
    putm('strings', S.note('contrabass_pizz', 'D2', .5, v), tp, -1, .2, 'pizz (1,300 km lands)' if k == ROUTE_PULSE else None)
    if k % 2 == 0 or k == ROUTE_PULSE: put(FAM['strings'], S.note('cellos_pizz', 'A2' if k < ROUTE_PULSE else 'D3', .5, v * .9), tp, -3, -.2)

# timpani: each stroke normalised, so a roll's crescendo is smooth across the velocity layers
def stroke(pitch, vel, rr):
    x = S.note('timpani', S.midi(pitch) + rr.normal(0, .05), 1.6, vel); return x / (np.abs(x).max() + 1e-12)
TIMP_REF = float(np.abs(S.note('timpani', 'D3', 2.5, .85)).max())   # level of a full stroke = 0 dB
def roll(pitch, t0, t1, a0, a1, rate, rr, ring=.12):
    """single strokes on one drum, each damping the previous ring; the last one rings `ring` s into the gap"""
    ts = [t0]
    while True:
        u = (ts[-1] - t0) / (t1 - t0); nxt = ts[-1] + 1 / (rate[0] + (rate[1] - rate[0]) * u)
        if nxt >= t1 - .02: break
        ts.append(nxt)
    for k, t in enumerate(ts):
        u = (t - t0) / (t1 - t0); x = stroke(pitch, .3 + .55 * u, rr) * TIMP_REF
        L = sec((ts[k + 1] - t if k + 1 < len(ts) else ring) + .03); x = x[:L].copy(); x[-sec(.03):] *= np.cos(np.linspace(0, np.pi / 2, sec(.03))) ** 2
        put(FAM['perc'], x, t + rr.normal(0, .003), a0 + (a1 - a0) * u ** 1.7, .12 if k % 2 else -.05)
rr = R('timpani')
putm('perc', S.note('timpani', 'Bb2', 2.5, .9), A['shatter'], 1, .05, 'timpani (shatter)')
putm('perc', S.hit('bass_drum', None, .9), A['shatter'], -1, 0, 'bass drum (shatter)')
for k in range(8, 14):                                               # the storm: on the beats, D and A
    u = (k - 8) / 6; x = stroke('D3' if k % 2 == 0 else 'A2', .4 + .3 * u, rr) * TIMP_REF
    put(FAM['perc'], x, T('w2', k * BEAT), -16 + 7 * u, .1 if k % 2 else -.05)
roll('A2', T('w2', 14 * BEAT), A['wave'] - .06, -16, -5, (11, 20), rr, .04)    # into the break
putm('perc', S.note('timpani', 'D3', 3.0, 1.), A['wave'], 3, .05, 'timpani (wave)')
putm('perc', S.note('timpani', 'A2', 3.0, .9), A['wave'], -2, -.1)
putm('perc', S.hit('bass_drum', None, 1.), A['wave'], 1, 0, 'bass drum (wave)')
gong = S.hit('gong', None, .8)[:sec(4.5)].astype(float); gong *= np.exp(-np.clip(tv(len(gong)) - 1.2, 0, None) / .9) * edges(len(gong), 0, .05)
put(FAM['perc'], gong / (np.abs(gong).max() + 1e-12) * TIMP_REF, A['wave'], -12, -.2)     # a tam-tam blooms under it
roll('D3', A['count3'] + .25, A['hit2'] - .07, -34, -17, (11, 16), rr, .03)   # under the 28 count, soft
putm('perc', S.note('timpani', 'D3', 3.0, .82), A['hit2'], -1, .05, 'timpani (28)')
putm('perc', S.hit('bass_drum', None, .6), A['hit2'], -3, 0, 'bass drum (28)')

def knee(x, thr, crest=1.6):
    """soft peak rounding above thr (linear), towards thr × crest: the drums' first milliseconds give way, their body stays"""
    ax = np.abs(x); c = thr * crest; o = ax > thr; y = x.copy()
    y[o] = np.sign(x[o]) * (thr + (c - thr) * np.tanh((ax[o] - thr) / (c - thr))); return y
PERC_KNEE = -9.0               # dB re the bus peak: the timpani / bass drum attacks are rounded above this
FAM['perc'] = knee(FAM['perc'], np.abs(FAM['perc']).max() * dbl(PERC_KNEE))
FAM['strings'] = np.stack([hp(FAM['strings'][:, c], 36, 2) for c in range(2)], 1) * dbl(curve(STR_RIDE, TT))[:, None]
FAM['brass'] = np.stack([hp(FAM['brass'][:, c], 36, 2) for c in range(2)], 1) * dbl(curve(STR_RIDE, TT))[:, None]
FAM['piano'] = np.stack([hp(FAM['piano'][:, c], 40, 2) for c in range(2)], 1)   # the low octaves keep their harmonics, not the sub
MUSIC = (FAM['strings'] * dbl(G_STRINGS) + FAM['brass'] * dbl(G_BRASS) + FAM['piano'] * dbl(G_PIANO) + FAM['perc'] * dbl(G_PERC))
MUSIC = S.room(MUSIC.astype(np.float32), **VERB).astype(float)
MUSIC_KNEE = -5.5             # dB re the music's own peak: only the tutti's attacks pass it
MUSIC = knee(MUSIC, np.abs(MUSIC).max() * dbl(MUSIC_KNEE), 1.45)
# the silence: the score stops dead at the route's landing and stays out until the red pen underlines "Marooned"
MGATE = np.ones(N); a, b, c = sec(A['sil'] - SIL_FADE), sec(A['sil']), sec(A['pen'] - .01)
MGATE[a:b] = np.cos(np.linspace(0, np.pi / 2, b - a)) ** 2; MGATE[b:c] = 0.
MUSIC *= MGATE[:, None] * dbl(G_MUSIC)
print('score %.1f s' % (time.time() - t1))

# ═══════════════════════════════ 2. PLACE ═══════════════════════════════
t1 = time.time()
PLACE = bus()
# the roar cuts on the wave's whiteout: a 70 ms breath in (−7 dB) so the hit lands, a 12 ms cut, nothing until the beach
def cut_env(t_cut, dip=-7., dip_len=.07, fade=.012, back=None):
    g = np.ones(N); a, b, c = sec(t_cut - dip_len), sec(t_cut), sec(t_cut + fade)
    g[a:b] = dbl(dip * np.sin(np.linspace(0, np.pi / 2, b - a)) ** 2)
    g[b:c] = dbl(dip) * np.cos(np.linspace(0, np.pi / 2, c - b)) ** 2; g[c:] = 0
    if back is not None: g[sec(back):] = 1
    return g
STORM_CUT = cut_env(A['wave'], back=A['swell'] - .6)
# wind: a pink-ish body under a moving low-pass + a howl; gusts rise (u^pow) to their whiteouts, then break
WIND_HP, WIND_G = 70.0, -23.0
WIND_DB = [('start', 0, -80), ('start', .15, -30), ('flash', -.02, -27), ('flash', .35, -16), ('flash', 1.3, -12), ('cut', -.05, -9), ('cut', .12, -17),
           ('crack', 0, -17), ('shatter', 0, -24), ('shatter', .8, -15), ('g1', 0, -14), ('w1', .05, -12), ('sink', 1.6, -13),
           ('sinkEnd', -.25, -14), ('sinkEnd', .05, -24), ('g2', .3, -24), ('w2', .05, -10), ('w2', .7, -14), ('spray', 0, -14),
           ('w3', .05, -12), ('rise', 0, -14.5), ('brk', 0, -15), ('wave', 0, -14), ('wave', .02, -90), ('w5', -.6, -90), ('w5', .02, -14),
           ('fade', 0, -15), ('fadeEnd', .15, -90), ('end', 0, -90)]
def _held(vals):
    out = [('start', 0, vals[0][1])]
    for (k, v), (_, prev) in zip(vals[1:], vals[:-1]): out += [(k, -.02, prev), (k, .02, v)]
    return out + [('end', 0, vals[-1][1])]
WIND_FC = _held([('start', 650), ('cut', 800), ('shatter', 620), ('w1', 700), ('w2', 1000), ('w3', 1250), ('w5', 900)])
WHISTLE_DB = _held([('start', -15), ('cut', -26), ('shatter', -17), ('w1', -15), ('w2', -21), ('w3', -8), ('w5', -27)])
WHISTLE_F = _held([('start', 470), ('cut', 600), ('shatter', 420), ('w1', 400), ('w2', 560), ('w3', 520), ('w5', 650)])
WHISTLE_GUST = .9
GUSTS = [(GUST[0]['t'], A['w1'], -1.0, 2.6, 2600, .30), (GUST[1]['t'], A['w2'], -1.0, 2.8, 3200, .45),   # snow gust · blizzard
         (SPRAY['t'], A['w3'], -5.0, 2.4, 3400, .30),                                                    # spray
         (T('w3', .9), T('w3', 1.6), -6.0, 2.0, 2600, .45), (T('rise', .3), T('rise', 1.1), -6.0, 2.0, 2800, .5),
         (T('rise', 1.4), A['wave'], -3.0, 1.7, 3800, .02),                                               # the howl climbs with the wave
         (SWL['t'], A['w5'], -6.0, 2.7, 3200, .3)]                                                       # the paper's white opens onto the beach
def gust_env(tf):
    amp = np.zeros_like(tf); br = np.zeros_like(tf); fcg = np.ones_like(tf) * 2400
    for t0, t1_, db, pw, fc, rel in GUSTS:
        u = np.clip((tf - t0) / (t1_ - t0), 0, 1); e = np.where(tf <= t1_, u ** pw, np.exp(-np.clip(tf - t1_, 0, None) / rel))
        e[tf < t0] = 0; amp += dbl(db) * e; sel = e > br; fcg[sel] = fc; br = np.maximum(br, e)
    return amp, br, fcg
def wind_gain(tf, f, c):
    r = R('wind%d' % c); nf = len(tf)
    base = dbl(curve(WIND_DB, tf) + 2.2 * fwander(r, nf, 70))
    gamp, gbr, gfc = gust_env(tf)
    fc = curve(WIND_FC, tf) * (gfc / curve(WIND_FC, tf)) ** gbr * 2 ** (.25 * fwander(r, nf, 50))
    F = np.maximum(f, 1.)[:, None]
    body = (F / 100) ** -.5 * (F / WIND_HP) ** 4 / (1 + (F / WIND_HP) ** 4) / (1 + (F / fc[None, :]) ** 2)
    body /= np.sqrt(np.mean(body ** 2, 0, keepdims=True))
    G = body * (base + gamp)[None, :]
    wf = curve(WHISTLE_F, tf) * (1 + .45 * gbr) * 2 ** (.12 * fwander(r, nf, 90))
    wa = dbl(curve(WHISTLE_DB, tf) + 2 * fwander(r, nf, 40)) * (1 + WHISTLE_GUST * gbr) * (base + gamp)
    for mul, g in [(1., 1.), (1.47, .5), (.68, .35)]:
        bw = wf * mul * .05
        gs = np.exp(-.5 * ((F - wf[None, :] * mul) / bw[None, :]) ** 2)
        G += g * wa[None, :] * gs / np.sqrt(np.mean(gs ** 2, 0, keepdims=True) + 1e-12)
    return G * dbl(WIND_G)
WIND = tame(shaped_noise(wind_gain, 'wind')) * STORM_CUT[:, None]
BEDS = bus(); BEDS += WIND        # the noise beds: summed, their crest is controlled together at the end
LAYERS = {'wind': WIND}           # (kept for the checks: what makes a peak)
# spindrift / sleet: the fine hiss of snow grains in the air (follows the wind)
SPIN_DB = [('start', 0, -90), ('flash', 0, -56), ('flash', .4, -37), ('cut', 0, -37), ('cut', .1, -47), ('shatter', .6, -43), ('w1', 0, -40),
           ('sinkEnd', 0, -41), ('w2', 0, -33), ('w2', .8, -42), ('w3', 0, -35), ('wave', 0, -33), ('wave', .02, -90),
           ('w5', 0, -90), ('w5', .1, -48), ('fadeEnd', 0, -90), ('end', 0, -90)]
r = R('spin'); sp = np.stack([bp(r.standard_normal(N), 3200, 11000) * (1 + .5 * np.clip(fwander(r, N, sec(.08)), -1.5, 3)) for _ in range(2)], 1)
LAYERS['spindrift'] = urms(sp) * dbl(curve(SPIN_DB, TT))[:, None] * STORM_CUT[:, None]; BEDS += LAYERS['spindrift']

# sea, shore: the surf of the launch and the beach, waves rising to their crests, shingle drawn back after each
SEA_G = -21.0
SHORE_WASH = [('w2', -.45, -90), ('w2', 0, -6), ('w2', .6, -8), ('spray', 0, -6), ('w3', 0, -8), ('w3', .05, -90),
              ('w5', -.4, -90), ('w5', 0, -8), ('w5', .8, -11), ('hit2', 0, -12), ('fade', 0, -12), ('fadeEnd', .25, -90), ('end', 0, -90)]
SHORE_WAVES = [(T('w2', .06), -5, .3, .9), (T('w2', 1.65), -5, .8, 1.2), (T('spray', .3), -7, .6, .4),
               (T('w5', .06), -6, .5, 1.1), (T('w5', 2.4), -10, .9, 1.4), (T('w5', 3.85), -9, .9, 1.3)]
def wave_env(tf, tc, rise, decay):
    u = np.clip((tf - (tc - rise)) / rise, 0, 1); return np.where(tf <= tc, u ** 2, np.exp(-(tf - tc) / decay))
def sea_gain_of(wash, waves, low=90., top=700.):
    def g(tf, f, c):
        F = np.maximum(f, 1.)[:, None]
        w = dbl(curve(wash, tf)) * (1 + .3 * np.sin(2 * np.pi * tf / 4.2 + c * .7))
        sh = (F / 100) ** -.4 * (F / low) ** 4 / (1 + (F / low) ** 4) / (1 + (F / top) ** 2)
        G = sh / np.sqrt(np.mean(sh ** 2)) * w[None, :]
        for tc, db, ri, de in waves:
            e = wave_env(tf, tc, ri, de); fc = 900 + 6500 * e
            br = (F / 200) ** -.25 * (F / 110) ** 4 / (1 + (F / 110) ** 4) / (1 + (F / fc[None, :]) ** 2)
            G += br / np.sqrt(np.mean(br ** 2, 0, keepdims=True)) * (dbl(db) * e)[None, :] * 1.6
        return G * dbl(SEA_G)
    return g
SHORE = tame(shaped_noise(sea_gain_of(SHORE_WASH, SHORE_WAVES), 'shore'))
fade_place = np.cos(np.pi / 2 * np.clip((TT - A['fade']) / (A['fadeEnd'] + .2 - A['fade']), 0, 1)) ** 2   # the picture fades: so does the place
LAYERS['shore sea'] = SHORE * fade_place[:, None]; BEDS += LAYERS['shore sea']
r = R('shingle'); sks = kernels(r, 5, 1800, 9000, [.4, .7, 1.1, 1.6, 2.4])
for k, (tc, db, ri, de) in enumerate(SHORE_WAVES):
    if A['w3'] - .2 < tc < A['w5'] - .2: continue          # no shingle in the open sea
    for c in range(2):
        d = 2.0; n = sec(d); rate = 700 * np.exp(-np.linspace(0, d, n) / .7) * np.clip(np.linspace(0, d, n) / .35, 0, 1)
        tg = np.nonzero(r.random(n) < rate / SR)[0] / SR
        x2 = np.zeros((n, 2)); x2[:, c] = scatter(n, tg, r.uniform(.2, 1, len(tg)), sks, r)
        put2(PLACE, x2 * fade_place[sec(tc + .55):sec(tc + .55) + n, None] if sec(tc + .55) + n <= N else x2, tc + .55, -30 + db + 12)

# sea, storm: the open ocean at night, heavier and lower, crests throwing spray; drawn into the giant wave
STORM_WASH = [('w3', -.05, -90), ('w3', 0, -8), ('rise', 0, -9), ('riseEnd', 0, -11), ('wave', 0, -12), ('wave', .02, -90), ('end', 0, -90)]
STORM_WAVES = [(T('w3', .08), -6, .3, .8), (T('w3', 1.25), -6, .7, 1.0), (T('w3', 2.5), -7, .8, 1.0), (T('w3', 3.6), -12, .7, .8)]
LAYERS['storm sea'] = tame(shaped_noise(sea_gain_of(STORM_WASH, STORM_WAVES, low=75., top=450.), 'stormsea')) * STORM_CUT[:, None]; BEDS += LAYERS['storm sea']

# the giant wave: a deep sub swell and a roar that opens up as the wall rises; the crest tears over the lens
def giant():
    t0, tb, tw = A['rise'], A['brk'], A['wave']
    u = np.clip((TT - (t0 - .3)) / (tb - t0 + .3), 0, 1); e = .55 * u ** 1.8
    ub = np.clip((TT - tb) / (tw - tb), 0, 1); e = np.where(TT >= tb, .55 + .45 * ub ** 1.2, e); e[TT >= tw + .02] = 0
    r = R('giant')
    # 1 the sub swell: a slow tone rising 31 → 44 Hz in a bed of low rumble, saturated so its harmonics speak
    f = 31 + 13 * np.clip((TT - t0) / (tw - t0), 0, 1); ph = 2 * np.pi * np.cumsum(f) / SR
    rum = lp(lp(np.cumsum(r.standard_normal(N)), 70), 70); rum = hp(rum, 20) ; rum /= rms(rum[sec(t0):sec(tw)]) + 1e-12
    sub = (np.sin(ph) * .75 + rum * .45) * e ** 1.3
    sub = hp(np.tanh(2.0 * sub / (np.abs(sub).max() + 1e-12)), 24)
    # 2 the roar: noise whose low-pass opens 220 Hz → 6 kHz with the wall, churning
    tfe = TT[::HOP]; ee = e[::HOP]
    def roar_gain(tf, fq, c):
        rr = R('roar%d' % c); ei = np.interp(tf, tfe, ee); fc = 220 * (6000 / 220) ** np.clip(ei / .9, 0, 1)
        F = np.maximum(fq, 1.)[:, None]
        sh = (F / 150) ** -.35 * (F / 60) ** 4 / (1 + (F / 60) ** 4) / (1 + (F / fc[None, :]) ** 2)
        churn = np.clip(1 + .35 * fwander(rr, len(tf), 6), .3, 2)
        return sh / np.sqrt(np.mean(sh ** 2, 0, keepdims=True)) * (ei * churn)[None, :]
    roar = shaped_noise(roar_gain, 'roar')
    # 3 the break: the lip tearing (bright water), spray hiss and splash grains over its last 0.8 s
    nb_ = sec(tw - tb + .02); tb_ = tv(nb_); ue = np.clip(tb_ / (tw - tb), 0, 1) ** 1.4
    tear = np.stack([hp(R('tear%d' % c).standard_normal(nb_), 900) * (1 + .6 * np.abs(lp(R('tm%d' % c).standard_normal(nb_), 14)) / .05) for c in range(2)], 1)
    tear = tear / rms(tear) * ue[:, None]
    gt = np.sort(r.uniform(0, tw - tb, 140)); spl = scatter2(nb_, gt, r.uniform(.2, 1, len(gt)) * np.clip(gt / (tw - tb), .1, 1), r.uniform(-.9, .9, len(gt)),
                                                               kernels(r, 5, 500, 6000, [4, 7, 10, 15, 22]), 'splash')
    out = np.stack([sub, sub], 1) * dbl(-26) + roar / (rms(roar[sec(tb - .3):sec(tw)]) + 1e-12) * dbl(-25)
    put2(out, tear * dbl(-23) + unit(spl) * dbl(-19), tb)
    return tame(out, 2.8, 3)
LAYERS['giant wave'] = giant() * STORM_CUT[:, None]; BEDS += LAYERS['giant wave']
LAYERS['beds (tamed)'] = tame(BEDS, 2.5, 3.5); PLACE += LAYERS['beds (tamed)']

# the ice and the wreck: groans (stick-slip on low resonances + a slow tonal moan), creaks, snaps, timber cracks
def stickslip(r, n, rate):
    w = lp(r.standard_normal(n), 2.5); w = (w - w.min()) / (np.ptp(w) + 1e-12)
    rt = rate[0] + (rate[1] - rate[0]) * w
    ph = np.cumsum(rt) / SR; idx = np.nonzero(np.diff(np.floor(ph)) > 0)[0]
    imp = np.zeros(n); imp[idx] = r.uniform(.35, 1, len(idx)); return imp
def resonator(r, modes, dur=.3):
    it = tv(sec(dur))
    return sum(a * np.sin(2 * np.pi * f * r.uniform(.95, 1.05) * it + r.uniform(0, 6.3)) * np.exp(-it / tau) for f, tau, a in modes)
def groan(r, d, f0=(62, 118), rate=(9, 24), tonal=.55):
    n = sec(d); t = tv(n); u = t / d
    fric = fftconvolve(stickslip(r, n, rate), resonator(r, [(85, .07, 1), (160, .06, .8), (300, .045, .6), (560, .03, .4), (980, .018, .25)]))[:n]
    f = f0[0] + (f0[1] - f0[0]) * (.5 - .5 * np.cos(2 * np.pi * u * r.uniform(.6, 1.1) + r.uniform(0, 3)))
    ph = 2 * np.pi * np.cumsum(f) / SR
    ton = (np.sin(ph) + .45 * np.sin(2 * ph + 1) + .25 * np.sin(3 * ph + 2)) * (.55 + .45 * unit(lp(np.abs(fric), 30)))
    env = np.sin(np.pi * u) ** 1.3 * (.75 + .25 * u)
    x = lp(unit(fric) * (1 - tonal) + unit(ton) * tonal, 1700) * env
    return urms(x, env > .3)
def creak(r, d, rate=(28, 85), modes=(430, 870, 1450, 2400, 3300)):
    n = sec(d); u = tv(n) / d
    x = fftconvolve(stickslip(r, n, rate), resonator(r, [(m, tau, a) for m, tau, a in zip(modes, (.014, .01, .007, .005, .003), (1, .8, .6, .4, .25))], .1))[:n]
    env = np.sin(np.pi * u) ** .8 * (.6 + .4 * np.abs(np.sin(np.pi * u * r.uniform(1.5, 3))))
    x = hp(x, 200) * env; return urms(x, env > .3)
def snap(r):
    n = sec(.25); t = tv(n)
    x = hp(r.standard_normal(n), 1500) * np.exp(-t / .0015) + .35 * np.sin(2 * np.pi * r.uniform(2600, 4200) * t) * np.exp(-t / .02)
    return unit(lp(x, 6000))
def timber_crack(r):
    d = 1.3; n = sec(d); t = tv(n)
    snap_ = hp(r.standard_normal(n), 600) * np.exp(-t / .0022)
    body = sum(a * np.sin(2 * np.pi * f * r.uniform(.96, 1.04) * t + r.uniform(0, 6.3)) * np.exp(-t / tau)
               for f, a, tau in [(165, 1, .06), (380, .8, .04), (700, .6, .028), (1250, .45, .016), (2300, .3, .009)])
    st = .004 + r.exponential(.09, 34); st = st[st < .6]
    spl = scatter(n, st, r.uniform(.3, 1, len(st)) * np.exp(-st / .14), kernels(r, 4, 1400, 7500, [1, 1.6, 2.5, 4]), r)
    thud = np.sin(2 * np.pi * np.cumsum(70 - 22 * np.clip(t / .25, 0, 1)) / SR) * np.exp(-t / .11) + lp(r.standard_normal(n), 260) * np.exp(-t / .035) * .7
    crunch = bp(r.standard_normal(n), 280, 4500) * np.exp(-t / .03) * (1 + .6 * np.abs(lp(r.standard_normal(n), 120)) / .1)
    x = unit(snap_) * .7 + unit(body) * .55 + unit(spl) * .45 + unit(thud) * .75 + unit(crunch) * .6
    return unit(echoes(x, [(.105, .22, 2600), (.185, .13, 1900), (.29, .07, 1400)]))
def far(x, fc=2400, taps=((.11, .3, 1500), (.23, .16, 1000))):
    """seen from the ice camp: duller, with the ice field's slap"""
    return echoes(lp(x, fc), taps)
ICE_G = -24.0
r = R('ice')
put(PLACE, far(tame(groan(r, 1.6, (40, 70), (6, 15), .5), 3.2, 3), 1400), T('count1', 1.1), ICE_G - 13, -.5)    # far off: the pack is moving
# the wreck: the timbers groan under the pressure, the rigging creaks, a beam gives way
for at, d, f0, pan, db in [(T('groan', 0), GROAN['dur'], (44, 82), .2, 0), (T('groan', .9), 1.3, (58, 104), -.3, -3)]:
    put(PLACE, tame(groan(r, d, f0, (7, 19), .55), 3.2, 3), at, ICE_G + db, pan)
CREAK_PK = -15.0               # dBFS peak of a close creak (they are impulse trains: levelled by peak, not RMS)
for at, d, pan, db in [(T('shatter', .9), .8, .35, -4), (T('groan', .45), .7, -.25, -3), (T('groan', 1.25), .9, .4, -2), (T('groan', 1.9), .6, -.1, -5)]:
    put(PLACE, unit(tame(creak(r, d, (35, 110), (620, 1150, 1900, 2900, 4100)), 3.2, 3)), at, CREAK_PK - 2 + db, pan)   # rope on wood: the rigging
put(PLACE, unit(tame(creak(r, 1.1, (22, 70)), 3.2, 3)), T('groan', .2), CREAK_PK - 2, -.1)
put(PLACE, timber_crack(R('beam')), T('groan', 1.5), -21, .3)
for at, pan, db in [(T('shatter', 1.5), -.5, -8), (T('groan', 1.75), .55, -9)]: put(PLACE, snap(r), at, ICE_G + 8 + db, pan)
# the sinking (from the ice camp): the long falling moan of her hull, ice grinding, her masts breaking, the water closing
def moan(r, d, f0, f1):
    n = sec(d); t = tv(n); u = t / d
    f = f0 * (f1 / f0) ** (u ** 1.5) * (1 + .02 * fwander(r, n, sec(.25)))
    ph = 2 * np.pi * np.cumsum(f) / SR
    ton = sum(np.sin(k * ph + r.uniform(0, 6.3)) / k ** 1.1 for k in range(1, 12))
    fric = fftconvolve(stickslip(r, n, (14, 34)), resonator(r, [(70, .08, 1), (140, .06, .8), (260, .05, .6), (520, .03, .4), (900, .02, .25)]))[:n]
    env = np.clip(u / .12, 0, 1) ** 1.5 * (.55 + .45 * np.clip((u - .3) / .5, 0, 1)) * edges(n, 0, .12)
    x = lp(unit(ton) * .6 * (.6 + .4 * unit(lp(np.abs(fric), 25))) + unit(fric) * .4, 1300) * env
    return urms(x, env > .5)
put(PLACE, far(tame(moan(R('moan'), A['sinkEnd'] - A['sink'] - .05, 96, 36), 3.4, 3), 1800), A['sink'], -21, .15)
def grind(r, d, rate=70):
    n = sec(d); u = tv(n) / d
    tg = np.sort(r.uniform(0, d, int(rate * d))); am = r.uniform(.2, 1, len(tg)) * (.3 + .7 * np.sin(np.pi * tg / d) ** .7)
    x = scatter(n, tg, am, kernels(r, 6, 180, 2600, [5, 9, 14, 20, 28, 40]), r)
    th = np.sort(r.uniform(.1, d - .2, 7)); x += .8 * unit(scatter(n, th, r.uniform(.5, 1, 7), kernels(r, 3, 40, 200, [40, 60, 80]), r))
    return urms(x * np.sin(np.pi * u) ** .5)
gr = stereo(lambda rr: far(grind(rr, 2.3), 2600), 'grind'); put2(PLACE, gr / (np.abs(gr).max() + 1e-12), T('sink', .2), -17)
for at, pan in [(T('sink', .1), .2), (T('sink', .85), -.15), (T('sink', 1.5), .3)]:
    put(PLACE, far(timber_crack(R('mast%.2f' % at)), 2200), at, -25, pan)
def rush(r, d):
    n = sec(d); u = tv(n) / d; e = u ** 2 * edges(n, 0, .1)
    x = urms(lp(r.standard_normal(n), 350)) * (1 - u) + urms(lp(r.standard_normal(n), 1800)) * u   # the water opens up as she slides
    bub = np.zeros(n)
    for tb_ in np.sort(r.uniform(.2, d - .1, 26)):
        m = sec(.05); tt_ = tv(m); f = r.uniform(300, 900) * (1 + 1.5 * tt_ / .05)
        k = sec(tb_); bub[k:k + m] += np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt_ / .015) * r.uniform(.3, 1)
    return urms(x * e + .25 * bub * e)
ru = stereo(lambda rr: far(rush(rr, A['sinkEnd'] - T('sink', 1.75)), 2000), 'rush'); put2(PLACE, ru / (np.abs(ru).max() + 1e-12), T('sink', 1.75), -17)

# the launch: wood knocking (the hull on the shingle, the oars on the gunwales), two oar strokes
def knock(r, modes, click=.5):
    n = sec(.18); t = tv(n)
    x = click * hp(r.standard_normal(n), 1500) * np.exp(-t / .001)
    x += sum(a * np.sin(2 * np.pi * f * r.uniform(.93, 1.07) * t + r.uniform(0, 6.3)) * np.exp(-t / tau) for f, tau, a in modes)
    return unit(x)
HULL = [(180, .05, 1), (420, .03, .7), (760, .02, .5), (1300, .012, .3)]
OAR = [(520, .02, 1), (1100, .012, .6), (1900, .008, .4)]
r = R('launch')
for at, db, pan, md in [(T('w2', .35), -22, .25, HULL), (T('w2', .7), -26, .3, OAR), (T('w2', 1.15), -21, .2, HULL), (T('w2', 1.45), -27, .35, OAR),
                        (T('w2', 2.0), -23, .15, HULL), (T('w2', 2.3), -25, .3, OAR), (T('w2', 2.75), -24, .25, HULL)]:
    put(PLACE, knock(r, md), at + r.normal(0, .01), db, pan)
for at in (T('w2', 1.6), T('w2', 2.6)):          # an oar bites: the rowlock clunks, the blade enters the water
    put(PLACE, knock(r, OAR, .8), at, -22, .3)
    m = sec(.4); spl = bp(r.standard_normal(m), 400, 4500) * np.exp(-tv(m) / .09) * np.clip(tv(m) / .01, 0, 1)
    put(PLACE, unit(spl), at + .04, -24, .32)
# the lifeboat in the storm: her small hull creaking close to us
for k, (at, d) in enumerate([(T('w3', .55), .6), (T('w3', 1.4), .8), (T('rise', .4), .7), (T('rise', 1.3), .9), (T('rise', 2.1), .7), (T('brk', .2), .5)]):
    put(PLACE, unit(tame(creak(r, d, (30, 95), (330, 700, 1250, 2100, 3000)), 3.2, 3)), at, CREAK_PK - (k % 2) * 3, -.3 + .12 * k)

# the desk: room tone and the lamp's hum, from the white
ROOM_DB = [('wave', 0, -90), ('wave', .15, -90), ('wave', .6, 0), ('swell', 0, 0), ('w5', .2, -90), ('end', 0, -90)]
r = R('room'); room = np.stack([lp(hp(np.cumsum(r.standard_normal(N)) * .03 + r.standard_normal(N) * .2, 60), 2600) for _ in range(2)], 1)
hum = sum(a * np.sin(2 * np.pi * f * TT + ph) for f, a, ph in [(100, 1, 0), (200, .5, 1), (300, .3, 2), (400, .12, .5), (600, .06, 1.2)])
hum *= 1 + .15 * np.sin(2 * np.pi * .7 * TT)
PLACE += (urms(room) * dbl(-45) + np.stack([hum, hum * .9], 1) / rms(hum) * dbl(-51)) * dbl(curve(ROOM_DB, TT))[:, None]
PLACE_PRE = PLACE.copy()
print('place %.1f s' % (time.time() - t1))

# ═══════════════════════════════ 3. DESIGN + FOLEY ═══════════════════════════════
t1 = time.time()
FX = bus()
# one magnesium flash (used, softer and without sparks, for the white of the flash cut): pop, sub whump, fizz, sparks, echo
def flash(r, big, crackle=True):
    d = 1.5; n = sec(d); t = tv(n)
    click = hp(r.standard_normal(n), 2500) * np.exp(-t / .0011)
    puff = bp(r.standard_normal(n), 140, 1600) * np.exp(-t / (.016 + .006 * big)) * np.clip(t / .0015, 0, 1)
    f = 36 + 46 * np.exp(-t / .028); ph = 2 * np.pi * np.cumsum(f) / SR
    whump = (np.sin(ph) + .4 * np.sin(2 * ph) + .18 * np.sin(3 * ph)) * np.exp(-t / (.13 + .05 * big)) * np.clip(t / .002, 0, 1)
    flut = np.clip(1 + 1.1 * lp(r.standard_normal(n), 220) / .045, 0, None)
    fizz = hp(r.standard_normal(n), 2800) * flut * (1 - np.exp(-t / .01)) * np.exp(-t / (.15 + .07 * big))
    x = unit(click) * .9 + unit(puff) * .75 + unit(whump) * 1.0 + unit(fizz) * .32
    if crackle:
        ct = .015 + r.exponential(.13, int(26 + 18 * big)); ct = ct[ct < .8]
        x += unit(scatter(n, ct, r.uniform(.2, 1, len(ct)) * np.exp(-ct / .22), crack_kernels(r, 5, 2500, 9000), r)) * .3
    return unit(echoes(x, [(.16, .2, 2200), (.29, .1, 1500), (.47, .05, 1100)]))
# THE flash: Hurley lit the night photograph with 25 charges of flash powder wired together and fired at once (Argonauts
# of the South, 1925). One burst from near-silence: the charges' pops a few ms apart across the field (the crack), the air
# pushed out of the trays (a deep whoomph), the magnesium burning out at 25 paces (a long fizz), sparks, the ice's echo
N_CHARGES = 25
CHARGE_SPREAD = .025           # s: the other 24 charges go off within this long after the first (which is on the cue)
FLASH_DB = -7.5                # dBFS peak of the burst (before the master gain)
def burst():
    r = R('burst'); d = 3.2; n = sec(d); t = tv(n)
    ts = np.concatenate([[0.], np.cumsum(r.exponential(1, N_CHARGES - 1))]); ts *= CHARGE_SPREAD / ts[-1]
    pans = np.concatenate([[0.], r.uniform(-.95, .95, N_CHARGES - 1)]); amps = np.concatenate([[1.], r.uniform(.45, 1, N_CHARGES - 1)])
    crack = np.zeros((n, 2)); m = sec(.15); tt = tv(m)
    for tk, pk, ak in zip(ts, pans, amps):        # 1 the crack: each charge its own colour and place
        pop = unit(hp(r.standard_normal(m), r.uniform(1400, 4000)) * np.exp(-tt / r.uniform(.0006, .0016))) \
            + .7 * unit(bp(r.standard_normal(m), r.uniform(120, 300), r.uniform(1400, 3200)) * np.exp(-tt / r.uniform(.008, .022)) * np.clip(tt / .001, 0, 1))
        k = sec(tk); crack[k:k + m, 0] += pop * ak / 1.7 * np.cos((pk + 1) * np.pi / 4) * 1.414; crack[k:k + m, 1] += pop * ak / 1.7 * np.sin((pk + 1) * np.pi / 4) * 1.414
    crack /= np.abs(crack).max()
    f = 31 + 75 * np.exp(-t / .05); ph = 2 * np.pi * np.cumsum(f) / SR          # 2 the whoomph
    wh = (np.sin(ph) + .5 * np.sin(2 * ph) + .25 * np.sin(3 * ph)) * np.exp(-t / .33) * np.clip(t / .004, 0, 1)
    whoomph = unit(unit(wh) + .6 * unit(lp(r.standard_normal(n), 240) * np.exp(-t / .1) * np.clip(t / .003, 0, 1)))
    env = np.mean([np.exp(-t / tk) for tk in r.uniform(.15, .9, N_CHARGES)], 0) * (1 - np.exp(-t / .012))   # 3 the fizz
    fizz = np.zeros((n, 2))
    for c in range(2):
        rc = R('fizz%d' % c); flut = np.clip(1 + 1.2 * lp(rc.standard_normal(n), 240) / .045, 0, None)
        fizz[:, c] = hp(rc.standard_normal(n), 2600) * flut * env + .35 * bp(rc.standard_normal(n), 800, 2600) * env ** 2
    fizz /= np.abs(fizz).max()
    ct = .01 + r.exponential(.4, 190); ct = ct[ct < d - .3]                       # 4 the sparks, thinning out over ~2 s
    sparks = scatter2(n, ct, r.uniform(.15, 1, len(ct)) * np.exp(-ct / .7), r.uniform(-.95, .95, len(ct)), crack_kernels(r, 6, 2500, 9500), 'sparks')
    sparks /= np.abs(sparks).max() + 1e-12
    x = crack + whoomph[:, None] + fizz * .38 + sparks * .3
    x = np.stack([echoes(x[:, c], [(.19, .22, 2200), (.36, .13, 1500), (.58, .07, 1000), (.83, .035, 800)]) for c in range(2)], 1)
    return soft(x / np.abs(x).max(), 1.8)
put2(FX, burst(), A['flash'], FLASH_DB)
put2(FX, stereo(lambda rr: flash(rr, .4, False), 'flashcut') * .8, A['cut'], -13)      # the flash cut: softer, no sparks
# out of the burst a low swell on D: the bloom of the light over the ice, hanging until the score takes it at the cut
def low_swell(r, d, rise=1.1):
    n = sec(d); t = tv(n)
    x = sum(a * np.sin(2 * np.pi * f * (1 + r.normal(0, .0012)) * t + r.uniform(0, 6.3)) for f, a in [(36.71, .3), (73.42, 1.), (110., .5), (146.83, .32), (220., .1)])
    br = bp(np.cumsum(r.standard_normal(n)) * .02, 60, 380)
    x = lp(x / rms(x) + .4 * br / rms(br), 900) * (1 + .08 * np.sin(2 * np.pi * .6 * t + r.uniform(0, 6)))
    env = np.clip(t / rise, 0, 1) ** 1.6 * edges(n, 0, .18)
    return x * env
put2(FX, stereo(lambda rr: low_swell(rr, A['cut'] + .08 - A['flash'] - .1, 1.5), 'lowswell'), A['flash'] + .1, -27)
# type ticks: n characters over dur
def tick(r, f=(2800, 4200), tau=.0009, hpf=2000):
    n = sec(.008); t = tv(n)
    return unit(hp(r.standard_normal(n), hpf) * np.exp(-t / tau) + .5 * np.sin(2 * np.pi * r.uniform(*f) * t) * np.exp(-t / .0016))
TICK_G = -31.0
r = R('type')
for e in TYPES:
    for i in range(e['n']):
        put(FX, tick(r), e['t'] + i * e['dur'] / e['n'] + r.normal(0, .0015), TICK_G + r.uniform(-4, 0), r.uniform(-.15, .15))
# count-ups: one counter tick per step of the displayed value (the picture's easing), and a flutter under it
COUNT_STEP, COUNT_TO, COUNT_EASE, COUNT_G = [7., 25., 1.], [281., 1300., 28.], ['eo', 'eio', 'eo'], [-33., -34., -29.]
r = R('count')
for i, e in enumerate(COUNTS):
    vals = np.arange(COUNT_STEP[i] / 2, COUNT_TO[i], COUNT_STEP[i])
    tk = e['t'] + INV[COUNT_EASE[i]](vals / COUNT_TO[i]) * e['dur']
    keep = [tk[0]]
    for t_ in tk[1:]:
        if t_ - keep[-1] > .016: keep.append(t_)
    for t_ in keep: put(FX, tick(r, (1500, 2500), .0012, 1200), t_, COUNT_G[i] + r.uniform(-3, 0), r.uniform(-.1, .1))
    n = sec(e['dur']); dens = np.zeros(n); np.add.at(dens, np.clip(((tk - e['t']) * SR).astype(int), 0, n - 1), 1.)
    dens = uniform_filter1d(dens, sec(.06)) * SR * .06; dens /= dens.max()
    fl = bp(r.standard_normal(n), 1500, 5000) * dens * edges(n, .01, .08)
    put(FX, urms(fl, dens > .2), e['t'], COUNT_G[i] - 11)

# the ice cracks: the impact, then fractures racing out from it across the field (the front reaches the frame's
# edges as the shards let go), with the dispersive "pew" of plate ice; a short reverse swell sucks into the break
IMPACT_PAN = (.57 - .5) * 2          # story.js: the impact point, x = 0.57 of the frame
def ice_ping(r, f0=4200, f1=260, tau=.035, dec=.055):
    n = sec(.3); t = tv(n); f = f1 + (f0 - f1) * np.exp(-t / tau)
    return unit(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / dec) * np.clip(t / .0005, 0, 1))
def racing(d):
    r = R('race'); n = sec(d + .4)
    tg = np.sort(np.concatenate([[0.], d * np.sqrt(r.uniform(0, 1, 170))]))          # more crack front, more grains
    u = tg / d; pans = np.clip(IMPACT_PAN + (.08 + .92 * u) * r.uniform(-1, 1, len(tg)), -1, 1)
    am = r.uniform(.15, .8, len(tg)) * (.4 + .6 * u); am[0] = .8
    x = scatter2(n, tg, am, pans, crack_kernels(r, 8, 1800, 9000), 'race')
    tb = np.sort(d * r.uniform(.05, 1, 16)); pb = np.clip(IMPACT_PAN + (.2 + .8 * tb / d) * r.uniform(-1, 1, 16), -1, 1)
    x += scatter2(n, tb, r.uniform(.4, 1, 16), pb, kernels(r, 5, 350, 2600, [3, 5, 8, 12, 18]), 'raceb') * .8
    for k, (tp, pp) in enumerate([(0., IMPACT_PAN), (.11 * d / .32, -.45), (.22 * d / .32, .7)]):
        y = ice_ping(R('ping%d' % k), 4200 - 600 * k); m = len(y); s = sec(tp)
        x[s:s + m, 0] += y[:n - s] * .5 * np.cos((pp + 1) * np.pi / 4) * 1.414; x[s:s + m, 1] += y[:n - s] * .5 * np.sin((pp + 1) * np.pi / 4) * 1.414
    imp = R('imp'); m = sec(.4); ti = tv(m)
    th = np.sin(2 * np.pi * np.cumsum(95 - 40 * np.clip(ti / .1, 0, 1)) / SR) * np.exp(-ti / .06)
    x[:m] += unit(th + .4 * lp(imp.standard_normal(m), 300) * np.exp(-ti / .02))[:, None] * .6
    return x / (np.abs(x).max() + 1e-12)
put2(FX, racing(A['shatter'] - A['crack']), A['crack'], -14)
def rev_swell(r, d):
    n = sec(d); t = tv(n)
    x = hp(r.standard_normal(n), 700) * np.exp(-t / (d / 3)) + .6 * scatter(n, r.exponential(d / 4, 60), r.uniform(.2, 1, 60), glass_kernels(r, 6, 1800, 8000), r)
    x = x[::-1] * np.clip(tv(n) / .03, 0, 1) * edges(n, 0, .008); return x / (np.abs(x).max() + 1e-12)
REV = .28                      # s: the reverse swell, ending 30 ms before the break
put2(FX, stereo(lambda rr: rev_swell(rr, REV), 'rev'), A['shatter'] - .03 - REV, -16)
# the plate ice breaks: glass modes and a crunch, the sheet's body, a low boom, the ice field's echo
def ice_break(r):
    d = 2.2; n = sec(d); t = tv(n)
    crash = hp(r.standard_normal(n), 900) * np.exp(-t / .06) * np.clip(t / .0008, 0, 1)
    crunch = bp(r.standard_normal(n), 250, 3500) * np.exp(-t / .035) * (1 + .7 * np.abs(lp(r.standard_normal(n), 140)) / .1)
    st = np.concatenate([[0.], r.exponential(.045, 90)]); st = st[st < .5]
    shards = scatter(n, st, r.uniform(.25, 1, len(st)) * np.exp(-st / .09), glass_kernels(r, 12, 1600, 9500), r)
    body = sum(a * np.sin(2 * np.pi * f * r.uniform(.95, 1.05) * t + r.uniform(0, 6.3)) * np.exp(-t / tau) for f, a, tau in [(190, 1, .09), (430, .8, .06), (820, .6, .04), (1500, .4, .025)])
    f = 33 + 40 * np.exp(-t / .06); ph = 2 * np.pi * np.cumsum(f) / SR
    boom = (np.sin(ph) + .4 * np.sin(2 * ph) + .2 * np.sin(3 * ph)) * np.exp(-t / .45) * np.clip(t / .003, 0, 1)
    thud = lp(r.standard_normal(n), 180) * np.exp(-t / .05)
    x = unit(crash) * .8 + unit(crunch) * .7 + unit(shards) * .75 + unit(body) * .55 + unit(boom) * .8 + unit(thud) * .5
    return soft(unit(echoes(x, [(.12, .22, 2400), (.23, .13, 1700), (.37, .07, 1200)])), 2.2)
put2(FX, stereo(ice_break, 'break'), A['shatter'], -10.5)
def falling(d):
    r = R('fall'); n = sec(d + .4)
    tg = np.sort(np.concatenate([r.exponential(.25, 120), r.uniform(0, d, 25)])); tg = tg[tg < d]
    am = r.uniform(.15, 1, len(tg)) * np.exp(-tg / .45); pans = r.uniform(-.95, .95, len(tg))
    x = scatter2(n, tg, am, pans, glass_kernels(r, 10, 1400, 8500, (.01, .05)), 'fall')
    tc = np.sort(r.uniform(.05, d * .8, 14))
    x += scatter2(n, tc, r.uniform(.4, 1, 14) * np.exp(-tc / .5), r.uniform(-.8, .8, 14), glass_kernels(r, 5, 700, 2400, (.02, .08), 3), 'fallc') * .7
    return x / (np.abs(x).max() + 1e-12)
put2(FX, falling(A['shEnd'] - A['shatter'] + .3), T('shatter', .05), -15)

# the wave hit: the water slams into the lens; a sub boom with harmonics, a thud, a bright burst and its foam;
# rounded (soft-clipped) so it carries weight, not just a peak
def wave_hit(r):
    d = 3.2; n = sec(d); t = tv(n)
    click = hp(r.standard_normal(n), 3000) * np.exp(-t / .0015)
    slam_hi = hp(r.standard_normal(n), 1800) * np.exp(-t / .07) * np.clip(t / .0015, 0, 1)
    slam_lo = bp(r.standard_normal(n), 140, 1800) * np.exp(-t / .28) * np.clip(t / .002, 0, 1)
    f = 38 + 40 * np.exp(-t / .09); ph = 2 * np.pi * np.cumsum(f) / SR
    boom = (np.sin(ph) + .5 * np.sin(2 * ph) + .25 * np.sin(3 * ph)) * np.exp(-t / .65) * np.clip(t / .003, 0, 1)
    thud = lp(r.standard_normal(n), 160) * np.exp(-t / .07)
    foam = lp(hp(r.standard_normal(n), 300), 3500) * np.exp(-t / .45) * np.clip(t / .03, 0, 1)
    x = unit(click) * .2 + unit(slam_hi) * .45 + unit(slam_lo) * 1.0 + unit(boom) * .7 + unit(thud) * .45 + unit(foam) * .45
    return soft(unit(echoes(x, [(.15, .18, 1800), (.31, .09, 1100)])), 3.0)
put2(FX, stereo(wave_hit, 'wavehit'), A['wave'], -10)
# the low hits: a felt thump when 1,300 km lands (gone before the silence), the low one under the 28
def hit_sound(r, f0, f1, tau, d, harm, click):
    n = sec(d); t = tv(n); f = f1 + (f0 - f1) * np.exp(-t / .06); ph = 2 * np.pi * np.cumsum(f) / SR
    x = (np.sin(ph) + harm[0] * np.sin(2 * ph) * np.exp(-t / (tau * .6)) + harm[1] * np.sin(3 * ph) * np.exp(-t / (tau * .4))) * np.exp(-t / tau)
    x += click * lp(r.standard_normal(n), 900) * np.exp(-t / .006)
    x *= edges(n, .0005, min(.08, d * .4)); return unit(x)
r = R('hits')
put(FX, hit_sound(r, 66, 52, .07, A['sil'] - A['hit1'] + .04, (.25, .1), .3), A['hit1'], -15, 0)
put(FX, soft(hit_sound(r, 60, 41, .6, 3.0, (.4, .2), .6), 1.6), A['hit2'], -14, 0)

# pens: noise in the paper's band, roughened by the fibre and the paper's tooth, following the stroke's speed
def pen(r, dur, ease, band, rough=.8, rub=.2):
    n = sec(dur); u = np.linspace(0, 1, n); sp = speed(ease, u) ** .7
    fibre = np.abs(lp(r.standard_normal(n), 70)); fibre /= fibre.max()
    nt = int(dur * 900); tooth = scatter(n, r.uniform(0, dur, nt), r.uniform(.3, 1, nt), kernels(r, 3, *band, [.3, .5, .8]), r)
    x = (unit(bp(r.standard_normal(n), *band)) * (.4 + rough * fibre) + unit(tooth) * .5 + unit(bp(r.standard_normal(n), 350, 1200)) * rub) * sp
    x = tame(x * edges(n, .004, .012), 3.0, 3.0)
    return urms(x, sp > .3)
put(FX, pen(R('route'), ROUTE['dur'], 'eio', (1300, 6000), .9, .3), ROUTE['t'], -30, .15)
put(FX, pen(R('pen'), PEN['dur'], 'eo', (2200, 8500), .9, .25), PEN['t'], -25, -.1)
# the camera crosses the desk: paper sliding on paper and wood, with a breath of air
def paper_slide(r, d):
    n = sec(d); u = np.linspace(0, 1, n); sp = speed('ss', u)
    fr = bp(r.standard_normal(n), 500, 6000) * (.5 + .8 * np.abs(lp(r.standard_normal(n), 40)) / .02)
    nt = int(d * 500); tooth = scatter(n, r.uniform(0, d, nt), r.uniform(.2, 1, nt), kernels(r, 4, 1500, 7000, [.5, .8, 1.2, 2]), r)
    air = bp(r.standard_normal(n), 150, 700)
    x = (unit(fr) * .7 + unit(tooth) * .35 + unit(air) * .35) * sp ** 1.2
    return urms(tame(x, 3.0, 3.0), sp > .4)
put2(FX, stereo(lambda rr: paper_slide(rr, SLIDE['dur']), 'slide'), SLIDE['t'], -30)
# the air swell into the beach (a breath, not a riser)
def air_swell(r, d, tail=.6):
    n = sec(d + tail); t = tv(n); u = np.clip(t / d, 0, 1)
    env = u ** 1.8 * np.exp(-np.clip(t - d, 0, None) / (tail / 3))
    lo_, hi_ = bp(r.standard_normal(n), 200, 900), bp(r.standard_normal(n), 900, 3500)
    x = (unit(lo_) * (1 - .6 * u) + unit(hi_) * u * .7) * env; return x / rms(x[sec(d * .8):sec(d)])
put2(FX, stereo(lambda rr: air_swell(rr, SWL['dur']), 'swell'), SWL['t'], -28)
print('design %.1f s' % (time.time() - t1))

# ═══════════════════════════════ 4. MASTER ═══════════════════════════════
t1 = time.time()
def kweight(x):
    """ITU-R BS.1770 K-weighting at 48 kHz, along axis 0"""
    x = lfilter([1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, .73248077421585], x, axis=0)
    return lfilter([1., -2., 1.], [1, -1.99004745483398, .99007225036621], x, axis=0)
def loudness(x):
    """integrated loudness (LUFS, BS.1770-4 gating) and loudness range (LU, EBU Tech 3342)"""
    z = (kweight(x) ** 2).sum(1); cs = np.concatenate([[0.], np.cumsum(z)])
    def blocks(w, hop):
        n, h = sec(w), sec(hop); st = np.arange(0, len(z) - n + 1, h); return (cs[st + n] - cs[st]) / n
    zb = blocks(.4, .1); lb = -.691 + 10 * np.log10(zb + 1e-30); ok = lb > -70
    rel = -.691 + 10 * np.log10(zb[ok].mean()) - 10
    I = -.691 + 10 * np.log10(zb[ok & (lb > rel)].mean())
    zs = blocks(3., .1); ls = -.691 + 10 * np.log10(zs + 1e-30); ok = ls > -70
    rel = -.691 + 10 * np.log10(zs[ok].mean()) - 20; v = ls[ok & (ls > rel)]
    return I, float(np.percentile(v, 95) - np.percentile(v, 10))
def true_peak(x): return max(np.abs(resample_poly(x[:, c], 4, 1)).max() for c in range(x.shape[1]))
def limit(x, ceil):
    """linked look-ahead peak limiter: 5 ms look-ahead, 40 ms hold, 15 ms smoothing; touches only what passes ceil"""
    pk = np.abs(x).max(1); n5 = sec(.005)
    g = np.minimum(1, ceil / np.maximum(maximum_filter1d(pk, 2 * n5 + 1), 1e-12))
    g = uniform_filter1d(minimum_filter1d(g, sec(.04)), sec(.015))
    return x * g[:, None], g
def pdb_(x): return 20 * np.log10(np.abs(np.asarray(x, float)).max() + 1e-12)
def master_hp(x): return np.stack([hp(x[:, c], 30, 2) for c in range(2)], 1)
endf = np.ones(N); endf[-sec(END_FADE):] = np.cos(np.linspace(0, np.pi / 2, sec(END_FADE))) ** 2
STEMS = {'music': master_hp(MUSIC) * MGATE[:, None], 'place': master_hp(PLACE * dbl(G_PLACE)), 'fx': master_hp(FX * dbl(G_FX))}
for k in STEMS: STEMS[k] *= endf[:, None]
mix = STEMS['music'] + STEMS['place'] + STEMS['fx']
RAW_I, RAW_LRA = loudness(mix); RAW_TP = 20 * np.log10(true_peak(mix))
ceil_db = min(TP_MAX, TARGET_I + PLR_MAX)
G = dbl(TARGET_I - RAW_I); sc = ceil_db - .3        # sample-peak ceiling of the safety limiter
for it in range(12):                      # normalise; limit only the peaks that pass the ceiling; re-measure
    out, LIM = limit(mix * G, dbl(sc))
    I_, _ = loudness(out); TP_ = 20 * np.log10(true_peak(out))
    if TP_ > ceil_db: sc -= TP_ - ceil_db + .05
    elif abs(I_ - TARGET_I) > .03: G *= dbl(TARGET_I - I_)
    else: break
mix = out[:N]
sf.write(os.path.join(OUT, 'mix.wav'), mix.astype(np.float32), SR, subtype='PCM_24')
ST = {k: x * G * LIM[:, None] for k, x in STEMS.items()}
for k, x in ST.items(): sf.write(os.path.join(OUT, 'stems', k + '.wav'), x.astype(np.float32), SR, subtype='FLOAT')
print('master %.1f s' % (time.time() - t1))
T_RUN = time.time() - T_START

# ═══════════════════════════════ 5. CHECKS ═══════════════════════════════
def db(x): return 20 * np.log10(np.sqrt(np.mean(np.square(np.asarray(x, float)))) + 1e-12)
def pdb(x): return 20 * np.log10(np.abs(np.asarray(x, float)).max() + 1e-12)
I_out, LRA_out = loudness(mix); TP_out = 20 * np.log10(true_peak(mix))
back = sf.read(os.path.join(OUT, 'mix.wav'))[0]
print('\nwrote %s  %d samples = %.4f s (dur %.4f), %d Hz stereo, PCM 24 (read back: %d samples, %d channels)'
      % (os.path.join(OUT, 'mix.wav'), len(mix), len(mix) / SR, DUR, SR, len(back), back.shape[1]))
print('raw mix: I %.1f LUFS, LRA %.1f LU, TP %.1f dBTP · master gain %+.1f dB' % (RAW_I, RAW_LRA, RAW_TP, 20 * np.log10(G)))
nlim = int((LIM < .999).sum())
print('peak limiter: ceiling %.1f dBTP, touched %d samples (%.2f %% of the film), max reduction %.1f dB'
      % (ceil_db, nlim, 100 * nlim / N, -20 * np.log10(LIM.min())))
g_ = LIM.copy(); worst = []
for _ in range(6):
    i = int(np.argmin(g_))
    if g_[i] > .999: break
    worst.append('%.2f s −%.1f dB' % (i / SR, -20 * np.log10(g_[i]))); g_[max(0, i - sec(.4)):i + sec(.4)] = 1
print('  where it acts: %s' % (' · '.join(worst) or 'nowhere'))
for w_ in worst[:4]:
    t_ = float(w_.split(' s')[0]); sl = slice(sec(t_ - .03), sec(t_ + .03))
    parts = {**{k: v for k, v in LAYERS.items()}, 'other place': PLACE_PRE - LAYERS['beds (tamed)'], 'music': MUSIC, 'fx': FX}
    pk = sorted(((pdb_(v[sl] * G), k) for k, v in parts.items()), reverse=True)[:4]
    print('    %.2f s: ' % t_ + ' · '.join('%s %.1f' % (k, v) for v, k in pk))
print('  what makes the peaks (sample peak before the limiter, dBFS, with the master gain; ceiling %.1f):' % (20 * np.log10(dbl(sc))))
for nm, t0_, t1_ in [('shatter', A['shatter'] - .02, A['shatter'] + .35), ('wave rises', A['rise'], A['brk']), ('wave breaks', A['brk'], A['wave'] - .01),
                     ('wave hit', A['wave'] - .01, A['wave'] + .4), ('28', A['hit2'] - .02, A['hit2'] + .4)]:
    sl = slice(sec(t0_), sec(t1_)); fam = {k: pdb(FAM[k][sl] * dbl({'strings': G_STRINGS, 'brass': G_BRASS, 'piano': G_PIANO, 'perc': G_PERC}[k]) * G) for k in FAM}
    print('    %-11s music %5.1f (strings %5.1f brass %5.1f piano %5.1f perc %5.1f, dry) · place %5.1f · fx %5.1f · all %5.1f'
          % (nm, pdb(STEMS['music'][sl] * G), fam['strings'], fam['brass'], fam['piano'], fam['perc'], pdb(STEMS['place'][sl] * G), pdb(STEMS['fx'][sl] * G),
             pdb((STEMS['music'][sl] + STEMS['place'][sl] + STEMS['fx'][sl]) * G)))
print('OUT (own meter): I %.2f LUFS · LRA %.1f LU · true peak %.2f dBTP · TP − I %.1f dB · sample peak %.2f dBFS · clipped %d'
      % (I_out, LRA_out, TP_out, TP_out - I_out, pdb(mix), int((np.abs(back) >= 1).sum())))
try:
    p = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', os.path.join(OUT, 'mix.wav'), '-af', 'ebur128=peak=true',
                        '-f', 'null', '-'], capture_output=True, text=True)
    s = p.stderr[p.stderr.rfind('Summary:'):]
    fI = float(re.search(r'I:\s+(-?[\d.]+) LUFS', s).group(1)); fL = float(re.search(r'LRA:\s+(-?[\d.]+) LU', s).group(1))
    fTP = float(re.search(r'Peak:\s+(-?[\d.]+) dBFS', s).group(1))
    print('OUT (ffmpeg ebur128): I %.1f LUFS · LRA %.1f LU · true peak %.1f dBFS · TP − I %.1f dB' % (fI, fL, fTP, fTP - fI))
    p = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', os.path.join(OUT, 'mix.wav'), '-af',
                        'loudnorm=I=-14:TP=-1.2:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True)
    J = json.loads(p.stderr[p.stderr.rfind('{'):p.stderr.rfind('}') + 1])
    off_tp = float(J['input_tp']) + (-14 - float(J['input_i']))
    lin = off_tp <= -1.2 and float(J['input_lra']) <= 11
    print('mux.sh loudnorm pass 1: input I %s, TP %s, LRA %s → after %+.1f dB the peak would be %.1f dBTP → %s'
          % (J['input_i'], J['input_tp'], J['input_lra'], -14 - float(J['input_i']), off_tp, 'LINEAR (peaks kept)' if lin else 'DYNAMIC'))
except Exception as ex:
    print('ffmpeg meters failed:', ex)
s0, s1 = sec(A['sil']), sec(A['silEnd']); m = ST['music'][s0:s1]; mb = back[s0:s1]
print('SILENCE %.2f–%.2f s (%.2f s): music stem %s (peak %s dBFS); score out until %.2f s (%.2f s in all); whole mix there: RMS %.1f dBFS, peak %.1f dBFS'
      % (A['sil'], A['silEnd'], A['silEnd'] - A['sil'], 'EXACTLY ZERO' if not np.any(m) else 'NOT SILENT', '-inf' if not np.any(m) else '%.1f' % pdb(m),
         A['pen'], A['pen'] - A['sil'], db(mb), pdb(mb)))
def onset(x, t, look=.1, w=.01, hpf=200):
    """where the energy (above hpf) jumps most within ±look s: max of (mean square over the next w) / (over the previous 2w)"""
    y = hp(x.mean(1), hpf, 2) if hpf else x.mean(1); c = np.concatenate([[0.], np.cumsum(y ** 2)]); n = sec(w)
    i = np.arange(sec(t - look), sec(t + look)); post = (c[i + n] - c[i]) / n; pre = (c[i] - c[i - 2 * n]) / (2 * n)
    return i[int(np.argmax(post / (pre + 1e-14)))] / SR
FR = 1000 / 24
print('\ncue alignment, one frame = %.1f ms' % FR)
print(' design / hits: largest 10 ms energy jump (above 200 Hz) within ±0.1 s, in their own stem and in the finished mix:')
CUES = [('FLASH (25 charges)', A['flash'], 'fx')] + [
    ('flash cut', A['cut'], 'fx'), ('ice impact (crack)', A['crack'], 'fx'), ('SHATTER (peak 1)', A['shatter'], 'fx'),
    ('WAVE HIT (peak 2)', A['wave'], 'fx'), ('hit soft (1,300 km)', A['hit1'], 'fx'), ('28 HIT (peak 3)', A['hit2'], 'fx'),
    ('timpani+drum (shatter)', A['shatter'], 'perc'), ('timpani+drum (wave)', A['wave'], 'perc'), ('timpani+drum (28)', A['hit2'], 'perc')]
for name, t, stem in CUES:
    o1, o2 = onset(ST[stem] if stem in ST else FAM[stem], t), onset(mix, t); d1, d2 = 1000 * (o1 - t), 1000 * (o2 - t)
    print('  %-24s event %6.3f  %-5s %6.3f (Δ %+6.1f ms)  mix %6.3f (Δ %+6.1f ms)  %s' % (name, t, stem, o1, d1, o2, d2,
          'ok' if abs(d1) <= FR and abs(d2) <= FR else 'stem ok, masked in the mix' if abs(d1) <= FR else 'OFF'))
print(' music hits: placed on the event; attack of the sample itself (first sample above −20 dB of its peak):')
for name, t, la in MLOG:
    print('  %-28s event %6.3f  attack %6.3f  Δ %+6.1f ms  %s' % (name, t, t + la, 1000 * la, 'ok' if 1000 * la <= FR else 'OFF'))
print(' gust peaks (wind layer above 1.2 kHz, 50 ms RMS, maximum between the gust start and its end + 0.3 s):')
wh = WIND * G * LIM[:, None]; wh = np.stack([hp(wh[:, c], 1200, 4) for c in range(2)], 1)
env = np.sqrt(uniform_filter1d(wh ** 2, sec(.05), axis=0).mean(1))
for g0, g1_, *_ in GUSTS[:3] + GUSTS[-1:]:
    a, b = sec(g0), sec(min(DUR, g1_ + .3)); i = a + int(np.argmax(env[a:b]))
    print('  gust %5.2f → %5.2f: peak at %6.3f (Δ %+5.1f ms)' % (g0, g1_, i / SR, 1000 * (i / SR - g1_)))
SCN = [('flash (black)', 0, A['cut']), ('colour', A['cut'], A['crack']), ('crack + shatter', A['crack'], A['shEnd']),
       ('wreck', A['shEnd'], A['w1']), ('sinking', A['w1'], A['w2']), ('launch', A['w2'], A['w3']), ('storm', A['w3'], A['rise']),
       ('wave rises', A['rise'], A['brk']), ('wave breaks', A['brk'], A['wave']), ('hit + tail', A['wave'], A['route']),
       ('route', A['route'], A['sil']), ('silence', A['sil'], A['silEnd']), ('desk to "Marooned"', A['silEnd'], A['pen']),
       ('Marooned → white', A['pen'], A['w5']), ('beach before 28', A['w5'], A['hit2']), ('beach after 28', A['hit2'], A['fade']),
       ('fade + tail', A['fade'], DUR)]
zk = (kweight(mix) ** 2).sum(1); ck = np.concatenate([[0.], np.cumsum(zk)]); nm4 = sec(.4); n3 = sec(3.)
MOM = -.691 + 10 * np.log10((ck[nm4:] - ck[:-nm4]) / nm4 + 1e-20)          # momentary loudness, window ending at each sample
SHT_ = -.691 + 10 * np.log10((ck[n3:] - ck[:-n3]) / n3 + 1e-20)             # short-term
print('\nscene                RMS dBFS:  mix   music   place   fx    | mix peak | max momentary LUFS (at) | limiter: max dB, % of samples')
for nm, a, b in SCN:
    sl = slice(sec(a), sec(b)); gl = LIM[sl]
    m_ = MOM[max(0, sec(a) - nm4 + sec(.2)):max(1, sec(b) - nm4 + sec(.2))]; im = int(np.argmax(m_))
    print('  %-20s %6.1f %7.1f %7.1f %6.1f   | %6.1f   | %6.1f (%5.2f s)        | %4.1f  %5.2f' % (nm, db(mix[sl]), db(ST['music'][sl]), db(ST['place'][sl]), db(ST['fx'][sl]),
          pdb(mix[sl]), m_[im], (max(0, sec(a) - nm4 + sec(.2)) + im + nm4) / SR - .2, -20 * np.log10(gl.min()), 100 * (gl < .999).mean()))
# loudness range: where the short-term (3 s) loudness sits below its 10th / above its 95th percentile (the LRA's two ends)
hop_ = sec(.1); ends = np.arange(n3, N + 1, hop_); lst = -.691 + 10 * np.log10((ck[ends] - ck[ends - n3]) / n3 + 1e-20)
okl = lst > -70; gate = -.691 + 10 * np.log10(((ck[ends] - ck[ends - n3]) / n3)[okl].mean()) - 20; vv_ = lst[okl & (lst > gate)]
p10, p95 = np.percentile(vv_, 10), np.percentile(vv_, 95)
def spans(mask):
    t_ = ends[mask] / SR; out, s_ = [], None
    for i_, t in enumerate(t_):
        if s_ is None: s_ = t
        if i_ + 1 == len(t_) or t_[i_ + 1] - t > .15: out.append('%.1f–%.1f' % (s_ - 3, t)); s_ = None
    return ', '.join(out)
print('short-term loudness: 10th pct %.1f LUFS (windows %s) · 95th pct %.1f LUFS (windows %s) → LRA %.1f LU'
      % (p10, spans(lst < p10), p95, spans(lst > p95), p95 - p10))
Fm = np.fft.rfft(mix.mean(1)); fq = np.fft.rfftfreq(N, 1 / SR); P = np.abs(Fm) ** 2
lo_e = P[(fq >= 20) & (fq < 120)].sum(); rest = P[(fq >= 120) & (fq < 16000)].sum()
print('energy 20–120 Hz vs 120 Hz–16 kHz: %.1f dB' % (10 * np.log10(lo_e / rest)))
print('L/R correlation %.2f' % np.corrcoef(mix[:, 0], mix[:, 1])[0, 1])

# plot: loudness over time (momentary 400 ms / short-term 3 s) + stems (RMS 100 ms) with the cues
try:
    from PIL import Image, ImageDraw
    Wp, Hp, L, Rm, Tp = 1800, 820, 70, 20, 30
    im = Image.new('RGB', (Wp, Hp), (250, 250, 247)); dr = ImageDraw.Draw(im)
    def X(t): return L + (Wp - L - Rm) * t / DUR
    panels = [(Tp, 360, -45, -5, 'LUFS (momentary grey, short-term black)'), (420, 780, -70, -5, 'stems RMS 100 ms, dBFS: music blue · place green · fx orange')]
    for y0, y1, v0, v1, lab in panels:
        dr.rectangle([L, y0, Wp - Rm, y1], outline=(160, 160, 160))
        for v in range(int(np.ceil(v0 / 5) * 5), int(v1) + 1, 5):
            y = y1 - (v - v0) / (v1 - v0) * (y1 - y0); dr.line([L, y, Wp - Rm, y], fill=(225, 225, 225)); dr.text((8, y - 6), '%d' % v, fill=(90, 90, 90))
        dr.text((L + 6, y0 + 4), lab, fill=(40, 40, 40))
    for s in range(0, int(DUR) + 1, 2):
        dr.text((X(s) - 6, Hp - 30), '%d' % s, fill=(90, 90, 90))
    for e in EV:
        if e['type'] in ('whiteout', 'hit', 'crack', 'shatter', 'silence', 'flash', 'cut', 'fade', 'rise', 'break'):
            dr.line([X(e['t']), Tp, X(e['t']), 780], fill=(200, 120, 120) if e['type'] != 'silence' else (120, 120, 200))
            dr.text((X(e['t']) + 2, 785 if e['type'] not in ('whiteout', 'shatter', 'break') else 798), e['type'], fill=(150, 60, 60))
    sx = (A['sil'], A['silEnd']); dr.rectangle([X(sx[0]), Tp + 1, X(sx[1]), 779], outline=(90, 90, 200))
    def lk(w, t):
        i1_ = np.clip((t * SR).astype(int), 1, N); i0_ = np.clip(i1_ - sec(w), 0, N); return -.691 + 10 * np.log10((ck[i1_] - ck[i0_]) / np.maximum(i1_ - i0_, 1) + 1e-12)
    ts = np.arange(0, DUR, .02)
    for w, col in [(.4, (150, 150, 150)), (3., (20, 20, 20))]:
        v = np.clip(lk(w, ts), -45, -5); pts = [(X(t), 360 - (vv + 45) / 40 * 330) for t, vv in zip(ts, v)]; dr.line(pts, fill=col, width=2)
    y = 360 - (TARGET_I + 45) / 40 * 330; dr.line([L, y, Wp - Rm, y], fill=(60, 160, 60)); dr.text((Wp - 160, y - 14), 'target %.0f LUFS' % TARGET_I, fill=(60, 140, 60))
    for k, col in [('place', (70, 150, 70)), ('fx', (230, 140, 30)), ('music', (40, 90, 200))]:
        e2 = uniform_filter1d((ST[k] ** 2).mean(1), sec(.1)); v = np.clip(10 * np.log10(e2[np.clip((ts * SR).astype(int), 0, N - 1)] + 1e-12), -70, -5)
        dr.line([(X(t), 780 - (vv + 70) / 65 * 360) for t, vv in zip(ts, v)], fill=col, width=2)
    im.save(os.path.join(OUT, 'mix_check.png'))
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', os.path.join(OUT, 'mix.wav'), '-lavfi',
                    'showspectrumpic=s=1600x600:legend=1:fscale=log:color=intensity', os.path.join(OUT, 'mix_spectrogram.png')], check=True)
    print('wrote out/mix_check.png, out/mix_spectrogram.png')
except Exception as ex:
    print('plots failed:', ex)
print('\nmix.py rendered in %.1f s' % T_RUN)
