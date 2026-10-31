"""Endurance: the soundtrack (score + place + foley, no voice) → out/mix.wav (48 kHz stereo, exactly events.json `dur` long).

Every cue time comes from events.json (exported from the picture's window.EV): the score is written against
named anchors (the whiteouts, the route, the hits, the silence...), so a retimed picture moves the sound with it.

Score (STYLE.md §7: restrained, low strings, piano, a low drone, timpani only at the two peaks), D minor → D major.
Built by register and density:
  newspaper   drone + one low piano note, then the motif A–D–E, left hanging
  portrait    the strings enter on the print (Dm → Gm/D) and swell with the gust into the first whiteout
  ice         Dm(add9) creeping to Bb(#11), a cold high tremolo, sparse high piano; the dominant (A) with a timpani
              roll that peaks exactly on the whiteout into the wreck
  wreck       the roll lands on Bb (deceptive), tremolo Bb → Gm → A, swelling into the map
  map         a thin open fifth, then a pulse (pizzicato + spiccato) under the route with the motif an octave up,
              landing on D with the soft hit
  silence     the score stops dead for the whole `silence` event (music bus = exact zero); only the air
  beach       low strings swell back in with the dive and the sea, Dsus2; a soft timpani roll under the count;
              the 28 lands: low hit, a warm D major chord blooms, the motif resolves A–D–E–F#, rings out under the fade
Place + foley: all synthesized here (numpy/scipy): wind and gusts, ice groans and hull creaks, the timber crack,
paper, pen scratches, type ticks, count-up ticks, the faint air of the map, sea and shingle, the two hits.

Run from the library root:  .venv/bin/python films/doc-parallax-test/mix.py
Writes out/mix.wav, out/stems/{music,place,fx}.wav (with the master gain and the safety limiter's gain: they sum
to the mix), out/mix_check.png (loudness + stems over time) and out/mix_spectrogram.png, then prints the checks.
"""
import os, sys, json, time, zlib, subprocess, re
T_START = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get('LIB') or os.path.abspath(os.path.join(HERE, '..', '..'))   # the library (build.sh exports LIB)
sys.path.insert(0, ROOT)
import numpy as np, soundfile as sf
from scipy.signal import stft, istft, lfilter, resample_poly, fftconvolve
from scipy.ndimage import uniform_filter1d, maximum_filter1d, minimum_filter1d
from core.audio.sfx import SR, bp, lp, hp, add
from core.audio import sampler as S

OUT = os.environ.get('OUT') or os.path.join(HERE, 'out')
os.makedirs(os.path.join(OUT, 'stems'), exist_ok=True)

# ═══════════════════════════════ PARAMETERS ═══════════════════════════════
SEED = 1914                    # the year she sailed
TARGET_I = -16.0               # LUFS integrated (mux.sh then brings it to −14 with a linear loudnorm)
TP_MAX = -1.5                  # dBTP absolute ceiling
PLR_MAX = 12.6                 # dB: true peak − loudness allowed, so mux's loudnorm stays LINEAR (its limit is 12.8;
                               # ffmpeg's loudnorm reads I ~0.2 LU higher than this meter, which only adds margin)

# bus balance (dB, before the master normalisation)
G_STRINGS, G_BRASS, G_PIANO, G_PERC, G_DRONE = -6.0, -9.0, -6.0, -4.0, -29.0
G_MUSIC = 0.0
G_PLACE = 0.0
G_FX = 0.0
VERB = dict(size=.42, mix=.20)  # the hall on the music (sampler.room)
# every note is levelled: the sample's velocity layer gives the colour, `vel` the level (the library's notes differ by up to
# 10 dB at one velocity: contrabass A1 vs D2, violas vs cellos); RMS of the held part / of a piano note's first second
SUS_REF, PIANO_REF, LEVEL_SLOPE = -28.0, -30.0, 30.0   # dBFS at vel .45 (sustains) / .30 (piano); dB per decade of vel

# string fader ride (anchor, offset s, dB): swells into each whiteout, ducks under the crack, the return after the silence
STR_RIDE = [('start', 0, 0), ('into', 0, 1.5), ('g1', 0, 1.5), ('w1', -.03, 5), ('w1', .35, 0), ('g2', 0, 0), ('w2', -.15, 4), ('w2', -.02, 1.5), ('w2', 0, 4),
            ('w2', .6, 2), ('crack', -.08, 2), ('crack', .02, -1.5), ('crack', 1.2, 0), ('g3', 0, -1), ('w3', -.03, 2.5),
            ('w3', .7, 0), ('route', 0, 0), ('hit1', 0, 2), ('silEnd', 0, -12), ('w4', -.04, 3), ('w4', .9, -4),
            ('count2', 0, -4), ('hit2', -.03, 0), ('hit2', .8, 1), ('fade', 0, .5), ('end', 0, -.5)]
# drone level (dB re G_DRONE)
# drone level (dB re G_DRONE): it enters with the first piano note, so that note is where the score begins
DRONE_RIDE = [('start', 0, -80), ('note', -.02, -80), ('note', .15, -24), ('note', 1.2, -4), ('swell', 0, -4),
              ('into', 0, -1), ('into', 1.0, -4), ('g1', 0, -4), ('w1', 0, 0), ('w1', .6, -2), ('g2', 0, -2), ('w2', 0, 1), ('w2', .8, -1), ('g3', 0, -1),
              ('w3', 0, 0), ('w3', .6, -5), ('route', 0, -5), ('hit1', 0, -3), ('silEnd', 0, -40), ('w4', 0, -3),
              ('w4', .8, -7), ('hit2', 0, -5), ('fade', 0, -6), ('end', 0, -24)]

# sustained notes: (start, end, instrument, pitch, vel, pan, attack s, release s); start/end = (anchor, offset s)
# (inner voices from C3 to F3 are on cellos: the library's three lowest viola samples, C3/D3/E3, sound an octave high)
SUS = [
    # portrait: the strings enter on the print (Dm), then Gm/D
    (('into', -.35), ('into', 2.3), 'cellos', 'D3', .42, -.2, 1.1, .5),
    (('into', 0), ('w1', 0), 'contrabass', 'D2', .40, .25, 1.4, .45),
    (('into', .5), ('into', 2.3), 'cellos', 'F3', .40, .1, .9, .5),
    (('into', 2.2), ('w1', 0), 'cellos', 'Bb2', .42, -.2, .5, .4),
    (('into', 2.2), ('w1', 0), 'violas', 'G3', .40, .1, .5, .4),
    # ice: Dm(add9) → Bb(#11) creep → A (dominant) under the timpani roll
    (('w1', 0), ('g2', 0), 'contrabass', 'D2', .45, .25, .25, .4),
    (('g2', -.05), ('w2', 0), 'contrabass', 'A1', .50, .25, .3, .25),
    (('w1', 0), ('w1', 2.65), 'cellos', 'A2', .42, -.2, .35, .5),
    (('w1', 2.55), ('g2', 0), 'cellos', 'Bb2', .44, -.2, .6, .4),
    (('g2', -.05), ('w2', 0), 'cellos', 'A2', .48, -.2, .3, .25),
    (('w1', .15), ('g2', 0), 'cellos', 'F3', .36, .1, 1.0, .4),
    (('g2', -.05), ('w2', 0), 'cellos', 'E3', .42, .1, .3, .25),
    (('w1', .85), ('g2', .1), 'violins_trem', 'E5', .22, .35, 1.6, .5),
    (('g2', -.05), ('w2', 0), 'violins_trem', 'C#5', .32, .35, .5, .2),
    (('g2', -.05), ('w2', 0), 'violins_trem', 'A4', .32, -.35, .5, .2),
    # wreck: Bb (the roll lands a semitone up) → Gm/Bb → A, tremolo
    (('w2', 0), ('w2', 2.6), 'contrabass', 'Bb1', .60, .25, .03, .6),
    (('w2', 2.5), ('w2', 4.0), 'contrabass', 'G1', .52, .25, .4, .5),
    (('w2', 3.95), ('w3', 0), 'contrabass', 'A1', .55, .25, .3, .3),
    (('w2', 0), ('w2', 2.6), 'cellos', 'F2', .50, -.2, .03, .6),
    (('w2', 0), ('w2', 4.0), 'cellos', 'D3', .48, -.2, .03, .5),
    (('w2', 2.5), ('w2', 4.0), 'cellos', 'G2', .48, -.2, .4, .5),
    (('w2', 3.95), ('w3', 0), 'cellos', 'A2', .52, -.2, .3, .3),
    (('w2', 3.95), ('w3', 0), 'cellos', 'E3', .48, -.1, .3, .3),
    (('w2', 0), ('w2', 2.6), 'violins_trem', 'F4', .38, -.3, .04, .5),
    (('w2', 0), ('w2', 4.0), 'violins_trem', 'D5', .36, .3, .04, .5),
    (('w2', 2.5), ('w2', 4.0), 'violins_trem', 'G4', .36, -.3, .4, .5),
    (('w2', 2.5), ('w2', 4.0), 'violins_trem', 'Bb4', .34, .1, .4, .5),
    (('w2', 3.95), ('w3', 0), 'violins_trem', 'A4', .40, -.3, .3, .3),
    (('w2', 3.95), ('w3', 0), 'violins_trem', 'C#5', .40, .3, .3, .3),
    (('w2', .6), ('w3', 0), 'violins_trem', 'E5', .24, .45, 1.2, .3),
    # map: a thin open fifth, then the chords over the pulse (Dm → Bb/D → A/D), all stopping on the soft hit
    (('w3', .05), ('hit1', 0), 'violins', 'A4', .24, -.3, .9, .12),
    (('w3', .05), ('hit1', 0), 'violins', 'D5', .24, .3, .9, .12),
    (('route', 0), ('route', 2.4), 'cellos', 'F3', .34, .1, .35, .25),
    (('route', 0), ('route', 1.6), 'violas', 'A3', .34, -.1, .35, .25),
    (('route', 1.55), ('route', 2.4), 'violas', 'Bb3', .38, -.1, .2, .25),
    (('route', 2.35), ('hit1', 0), 'cellos', 'E3', .34, .1, .2, .12),
    (('route', 2.35), ('hit1', 0), 'violas', 'A3', .33, -.1, .2, .12),
    (('route', 2.35), ('hit1', 0), 'violas', 'C#4', .36, 0, .2, .12),
    # beach: the low swell back in after the silence (Dsus2 under the sea), then D major when 28 lands
    (('silEnd', 0), ('hit2', 0), 'contrabass', 'D2', .50, .25, .62, .3),
    (('silEnd', 0), ('hit2', 0), 'cellos', 'A2', .45, -.2, .62, .3),
    (('w4', .1), ('hit2', 0), 'cellos', 'E3', .30, .1, .7, .3),
    (('w4', .1), ('hit2', 0), 'violas', 'A3', .30, -.1, .7, .3),
    (('w4', .5), ('hit2', 0), 'violins', 'A4', .22, -.3, .9, .3),
    (('hit2', 0), ('fade', .25), 'contrabass', 'D2', .54, .25, .06, 1.5),
    (('hit2', 0), ('fade', .25), 'cellos', 'D3', .52, -.2, .10, 1.5),
    (('hit2', 0), ('fade', .25), 'cellos', 'A3', .48, -.1, .15, 1.5),
    (('hit2', 0), ('fade', .25), 'violas', 'F#3', .52, .1, .20, 1.5),
    (('hit2', 0), ('fade', .25), 'violas', 'D4', .44, .15, .25, 1.5),
    (('hit2', 0), ('fade', .25), 'violins', 'A4', .40, -.3, .35, 1.5),
    (('hit2', 0), ('fade', .25), 'violins', 'F#5', .40, .3, .45, 1.5),
    (('hit2', .05), ('fade', .1), 'horn', 'F#4', .40, -.15, .30, 1.2),
    (('hit2', .05), ('fade', .1), 'horn', 'D4', .40, .15, .30, 1.2),
]
# piano (Salamander): (at, pitch, held s, vel, pan)
PIANO = [
    (('note', 0), 'D2', 4.6, .42, -.1),                                     # the score begins: one low note
    (('note', 1.15), 'A3', 2.5, .28, -.05), (('note', 1.9), 'D4', 2.4, .30, 0), (('swell', .55), 'E4', 3.2, .33, .05),
    (('w1', 0), 'D1', 3.5, .34, -.1), (('w1', 0), 'D2', 3.5, .30, -.1),         # night: a dark low octave
    (('w1', 2.3), 'F5', 2.0, .20, .2), (('w1', 3.45), 'E5', 2.0, .19, .2),      # cold, sparse
    (('route', .8), 'A4', 1.2, .27, .1), (('route', 1.6), 'D5', 1.2, .29, .1), (('route', 2.4), 'E5', 1.4, .32, .1),
    (('hit2', 0), 'D1', 3.6, .45, -.1), (('hit2', 0), 'D2', 3.6, .42, -.1),     # the 28 lands
    (('hit2', .95), 'A3', 3.0, .30, 0), (('hit2', 1.55), 'D4', 3.0, .31, 0), (('hit2', 2.15), 'E4', 3.0, .32, 0),
    (('hit2', 2.9), 'F#4', 3.0, .34, 0),                                     # the motif resolves to the major third
]
PULSE_N = 8                    # eighths over the route (route dur / 8 = one step)
PULSE_VEL = (.34, .62)
ROLL1 = dict(pitch='A2', a0=-32, a1=-8.5, rate=(12, 19))   # into the wreck: on the dominant, peaks on the whiteout
ROLL2 = dict(pitch='D3', a0=-36, a1=-13, rate=(11, 16))  # under the 28 count, softer
ROLL2_START = .3               # s after the count starts
ROLL_GAP = .07                 # s: each roll stops this much before its accent, so the accent lands

# place
WIND_HP = 80.0                 # Hz, the wind body's 4th-order low cut (the rumble would only muddy the strings)
WIND_G = -23.0                 # dBFS RMS of the wind body at 0 dB
# scene levels: each scene's air dips under the whiteout (the gust carries it) and comes in as the white clears (+.06…+.8 s)
WIND_DB = [('start', 0, -80), ('start', .45, -26), ('start', 1.6, -13), ('into', -.5, -13), ('into', 1.5, -9), ('g1', 0, -6),
           ('w1', 0, -9), ('w1', .06, -16), ('w1', .8, -9), ('g2', 0, -9), ('w2', 0, -10), ('w2', .06, -16), ('w2', .8, -6),
           ('g3', 0, -6), ('w3', 0, -8), ('w3', .35, -30), ('w3', .8, -90), ('w4', -.1, -90), ('w4', .06, -24), ('w4', .8, -15),
           ('fade', 0, -15), ('fadeEnd', .2, -90), ('end', 0, -90)]
# the colour of each scene's wind holds until its whiteout, then switches
def _held(vals):
    out = [('start', 0, vals[0][1])]
    for (k, v), (_, prev) in zip(vals[1:], vals[:-1]): out += [(k, -.02, prev), (k, .02, v)]
    return out + [('end', 0, vals[-1][1])]
WIND_FC = _held([('start', 700), ('into', 900), ('w1', 520), ('w2', 1100), ('w4', 950)])
WHISTLE_DB = _held([('start', -30), ('into', -26), ('w1', -15), ('w2', -21), ('w4', -30)])
WHISTLE_F = _held([('start', 520), ('into', 560), ('w1', 390), ('w2', 640), ('w4', 700)])
WHISTLE_GUST = .8              # the howl's extra rise in a gust (× 1 + this)
GUST_DB = [-2.0, -2.0, -2.0]      # each gust's peak (dB re WIND_G), exactly on its whiteout (14.0: the timpani roll carries the swell)
GUST_POW = 2.6                 # rise curve u^pow (steep at the end: the white snaps in)
GUST_FC = [2600, 2300, 2200]
GUST_REL = [.26, .08, .26, .22]   # s, each gust's decay after its whiteout (14.0: breaks off so the timpani lands)
DIVE_DB, DIVE_FC = -2.5, 3200   # the dive into Elephant Island: rises like the camera (ease-in), breaks into spray
ICE_G = -26.0                  # dBFS RMS of each groan / creak (before distance)
ICE_GROANS = [(.07, 1.6, -.45, 0), (.41, 1.9, .35, -2), (.71, 1.4, -.15, -1)]    # (fraction of the ice event, dur, pan, dB)
ICE_CREAKS = [(.30, .9, .1, -3), (.59, 1.1, .2, -1), (.82, .7, .05, -4)]
ICE_SNAPS = [(.17, -.5, -6), (.55, .55, -8), (.76, -.3, -7)]
WRECK_GROAN = (('w2', .15), 1.15, .2, -5)   # pressure in the ice as the wreck appears; gone before the crack
WRECK_CREAKS = [(('crack', .55), .8, .3, -6), (('crack', 1.9), 1.0, -.15, -5)]
CRACK_G = -12.0                # dBFS peak of the timber crack
CRACK_PAN = .35                # under the red word (right of centre)
SEA_G = -22.0                  # dBFS RMS of the wash at 0 dB
SEA_WASH = [('w4', -.7, -90), ('w4', 0, -4), ('w4', .8, -9), ('hit2', 0, -10), ('fade', 0, -11), ('fadeEnd', .25, -90), ('end', 0, -90)]
WAVES = [(0, -11.5, .65, 1.0), (2.65, -9, .9, 1.3), (4.75, -11, .8, 1.2)]   # (crest s after the sea starts, dB, rise s, decay s)
SHINGLE_G = -30.0
AIR_G = -52.0                  # the faint air of the map / the silence (dBFS RMS)
AIR_DB = [('w3', -.3, -60), ('w3', .6, 0), ('dive', .6, 0), ('w4', .2, -60)]

# fx
PAGE_G = -17.0                 # peak dBFS
PAGE_LAND = .30                # s after the page event when it touches down
PEN_EASE = ['eo', 'ss']        # the picture's easing of each pen stroke (story.js), in event order
PEN_G = [-32.0, -37.0]         # dBFS RMS while the pen moves
PEN_BAND = [(1200, 5500), (2600, 8500)]
DRIFT_DASHES = 22              # dashes along the drift line (dash 14 / gap 12)
ROUTE_EASE, ROUTE_G, ROUTE_BAND = 'eio', -33.0, (1300, 6000)
TICK_G = -31.0                 # peak dBFS of one type tick
COUNT_G = [-34.0, -28.0]       # peak dBFS of one counter tick (the 28 count sits over the sea)
COUNT_STEP = [25.0, 1.0]       # one counter tick per this many units
COUNT_TO = [1300.0, 28.0]
SWELL_RISE = .9                # s: the swell into the print rises over its last 0.9 s only (no riser longer than a gust)
SWELL_G = -30.0                # the air swell into the print (RMS at its top)
HIT_G = [-15.0, -13.0]          # soft / low hit, peak dBFS
NOISE_CREST, NOISE_KNEE = 2.8, 4.0   # wind / sea noise: peaks bent towards 2.8 × the local RMS above a 4 dB knee
END_FADE = .45                 # s, master fade at the very end
SIL_FADE = .15                 # s, the music fades to zero just before the silence

# ═══════════════════════════════ EVENTS ═══════════════════════════════
E = json.load(open(os.path.join(HERE, 'events.json')))
DUR = float(E['dur']); EV = E['ev']
N = int(round(DUR * SR))
TT = np.arange(N) / SR
def ev(ty): return sorted((e for e in EV if e['type'] == ty), key=lambda e: e['t'])
def one(ty):
    L = ev(ty); assert len(L) == 1, f'expected one {ty!r} event, got {len(L)}'; return L[0]
W = [e['t'] for e in ev('whiteout')]
GUST = ev('gust')
assert len(W) == 4 and len(GUST) == 3, 'expected four whiteouts and three gusts'
for g, w in zip(GUST, W[:3]): assert abs(g['t'] + g['dur'] - w) < 1e-6, 'a gust must end on its whiteout'
DIVE = one('dive'); assert abs(DIVE['t'] + DIVE['dur'] - W[3]) < 1e-6
HITS = ev('hit'); H_SOFT = [h for h in HITS if h.get('level') == 'soft'][0]; H_LOW = [h for h in HITS if h.get('level') == 'low'][0]
PENS, TYPES, COUNTS = ev('pen'), ev('type'), ev('count')
SIL, ROUTE, ICE, SEA, FADE = one('silence'), one('route'), one('ice'), one('sea'), one('fade')
A = {'start': 0., 'end': DUR, 'page': one('page')['t'], 'note': one('note')['t'], 'swell': one('swell')['t'],
     'into': one('into_print')['t'], 'g1': GUST[0]['t'], 'w1': W[0], 'g2': GUST[1]['t'], 'w2': W[1],
     'crack': one('crack')['t'], 'g3': GUST[2]['t'], 'w3': W[2], 'route': ROUTE['t'], 'routeEnd': ROUTE['t'] + ROUTE['dur'],
     'hit1': H_SOFT['t'], 'sil': SIL['t'], 'silEnd': SIL['t'] + SIL['dur'], 'dive': DIVE['t'], 'w4': W[3],
     'count2': COUNTS[1]['t'], 'hit2': H_LOW['t'], 'fade': FADE['t'], 'fadeEnd': FADE['t'] + FADE['dur']}
def T(a, o=0.): return A[a] + o

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
def speed(name, u):
    k = EASE[name](np.clip(u, 0, 1)); s = np.gradient(k, u); return np.clip(s / s.max(), 0, 1)
def bus(): return np.zeros((N, 2))
def put(b, x, t, g_db=0., pan=0.): add(b, np.asarray(x, float), t, float(dbl(g_db)), pan)
def put2(b, x2, t, g_db=0.):
    s = sec(t); e = min(N, s + len(x2))
    if e > s: b[s:e] += x2[:e - s] * dbl(g_db)

def kernels(r, k, lo, hi, ms):
    out = []
    for i in range(k):
        L = max(8, sec(ms[i % len(ms)] / 1000)); g = bp(r.standard_normal(L + 512), lo, hi)[512:] * np.hanning(L)
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

def tame(x, crest=None, knee=None, win=.05):
    """a noise bed's crest: identity below knee, then bent smoothly towards crest × its own local RMS (50 ms).
    Gaussian noise peaks at ~5 σ; this keeps it at ~3 σ without touching its level or anything else in the mix"""
    crest = crest or NOISE_CREST; knee = NOISE_KNEE if knee is None else knee
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

# ═══════════════════════════════ 1. SCORE ═══════════════════════════════
t1 = time.time()
S.seed(SEED)
FAM = {k: bus() for k in ('strings', 'brass', 'piano', 'perc', 'drone')}
def levelled(x, a, b, target):
    seg_ = x[sec(a):max(sec(a) + sec(.2), sec(b))]; return x * dbl(target) / (rms(seg_) + 1e-12)
for (a0, a1, inst, p, vel, pan, att, rel) in SUS:
    t0, te = T(*a0), T(*a1); d = te - t0
    x = levelled(S.note(inst, p, d, vel, release=rel, attack=att), att if d - att > .3 else 0, d, SUS_REF + LEVEL_SLOPE * np.log10(vel / .45))
    put(FAM['brass' if inst == 'horn' else 'strings'], x, t0, 0, pan)
MLOG = []    # (cue, event time, latency of the sample's attack) for the music hits
def putm(fam, x, t, g_db=0., pan=0., tag=None):
    put(FAM[fam], x, t, g_db, pan)
    if tag: ax = np.abs(x); MLOG.append((tag, t, int(np.argmax(ax > .1 * ax.max())) / SR))
for i, (a, p, d, vel, pan) in enumerate(PIANO):
    x = levelled(S.note('piano', p, d, vel), 0, min(1., d), PIANO_REF + LEVEL_SLOPE * np.log10(vel / .3))
    putm('piano', x, T(*a), 0, pan, 'first piano note' if i == 0 else None)

# the pulse under the route: pizzicato basses + spiccato cellos, eighths, a crescendo, two sixteenths into the landing
step = ROUTE['dur'] / PULSE_N
pulse_t = [A['route'] + k * step for k in range(PULSE_N)] + [A['route'] + (PULSE_N - .5) * step]
for k, tp in enumerate(sorted(pulse_t)):
    v = PULSE_VEL[0] + (PULSE_VEL[1] - PULSE_VEL[0]) * k / (len(pulse_t) - 1)
    putm('strings', S.note('contrabass_pizz', 'D2', .5, v), tp, 2, .2, 'pulse 1 (route starts)' if k == 0 else None)
    put(FAM['strings'], S.note('cellos_spic', 'D3', .3, v * .9), tp, -1, -.2)
putm('strings', S.note('contrabass_pizz', 'D2', .6, .66), A['hit1'], 2, .2, 'pizz (1,300 km lands)')   # the landing
put(FAM['strings'], S.note('cellos_pizz', 'D3', .6, .6), A['hit1'], 0, -.2)

# timpani: a roll is single strokes with rising level (each stroke normalised, so the crescendo is smooth across layers)
def stroke(pitch, vel, rr):
    x = S.note('timpani', S.midi(pitch) + rr.normal(0, .05), 1.6, vel); return x / (np.abs(x).max() + 1e-12)
TIMP_REF = float(np.abs(S.note('timpani', 'Bb2', 2.5, .85)).max())   # level of a full stroke = 0 dB
def roll(pitch, t0, t1, a0, a1, rate, rr, ring=.12):
    """single strokes on one drum: each stroke re-excites the same head, so it damps the previous ring (30 ms fade)
    instead of piling up; the last one rings `ring` s into the gap before the accent"""
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
roll(ROLL1['pitch'], A['g2'], A['w2'] - ROLL_GAP, ROLL1['a0'], ROLL1['a1'], ROLL1['rate'], rr)
putm('perc', S.note('timpani', 'Bb2', 2.5, .85), A['w2'], 1, .05, 'timpani (wreck)')       # the wreck
putm('perc', S.hit('bass_drum', None, .5), A['w2'], -3, 0, 'bass drum (wreck)')
putm('perc', S.note('timpani', 'D3', 1.0, .42), A['hit1'], -8, .05, 'timpani (1,300 km)')  # route lands (soft)
roll(ROLL2['pitch'], A['count2'] + ROLL2_START, A['hit2'] - ROLL_GAP, ROLL2['a0'], ROLL2['a1'], ROLL2['rate'], rr)
putm('perc', S.note('timpani', 'D3', 3.0, .75), A['hit2'], -2, .05, 'timpani (28)')        # 28
putm('perc', S.hit('bass_drum', None, .6), A['hit2'], -2, 0, 'bass drum (28)')

# the drone: D2 + A2 + D3 with a few harmonics (so it speaks on small speakers), slow beating, a breath of low noise
def drone():
    r = R('drone'); out = np.zeros((N, 2))
    for c in range(2):
        x = np.zeros(N)
        for f, a in [(73.416, .55), (110.0, .42), (146.83, .45), (220.0, .12)]:
            for h, ah in [(1, 1.), (2, .38), (3, .2), (4, .08)]:
                if f * h > 700: continue
                x += a * ah * np.sin(2 * np.pi * f * h * (1 + r.normal(0, .0011)) * TT + r.uniform(0, 2 * np.pi))
        br = bp(np.cumsum(r.standard_normal(N)) * .02, 80, 420)
        x = hp(lp(x / rms(x) + .22 * br / rms(br), 900), 55, 2)
        out[:, c] = x * (1 + .07 * np.sin(2 * np.pi * .11 * TT + c))
    return out / rms(out)
FAM['drone'] = drone() * dbl(curve(DRONE_RIDE, TT))[:, None]
FAM['strings'] = np.stack([hp(FAM['strings'][:, c], 38, 2) for c in range(2)], 1) * dbl(curve(STR_RIDE, TT))[:, None]
FAM['brass'] *= dbl(curve(STR_RIDE, TT))[:, None]
FAM['piano'] = np.stack([hp(FAM['piano'][:, c], 45, 2) for c in range(2)], 1)   # the low octaves keep their harmonics, not the sub

MUSIC = (FAM['strings'] * dbl(G_STRINGS) + FAM['brass'] * dbl(G_BRASS) + FAM['piano'] * dbl(G_PIANO)
         + FAM['perc'] * dbl(G_PERC))
MUSIC = S.room(MUSIC.astype(np.float32), **VERB).astype(float) + FAM['drone'] * dbl(G_DRONE)
# the silence: the score fades out just after the soft hit and is exactly zero until the silence ends
MGATE = np.ones(N); a, b, c = sec(A['sil'] - SIL_FADE), sec(A['sil']), sec(A['silEnd'])
MGATE[a:b] = np.cos(np.linspace(0, np.pi / 2, b - a)) ** 2; MGATE[b:c] = 0.
MUSIC *= MGATE[:, None] * dbl(G_MUSIC)
print('score %.1f s' % (time.time() - t1))

# ═══════════════════════════════ 2. PLACE ═══════════════════════════════
t1 = time.time()
PLACE = bus()
# wind: a pink-ish body under a moving low-pass + a howl, every gust rising (u^pow) to its whiteout, then breaking
GUSTS = [(g['t'], g['t'] + g['dur'], GUST_DB[i], GUST_POW, GUST_FC[i], GUST_REL[i]) for i, g in enumerate(GUST)]
GUSTS.append((DIVE['t'], DIVE['t'] + DIVE['dur'], DIVE_DB, 2.7, DIVE_FC, GUST_REL[3]))   # ease-in like the camera dive
def gust_env(tf):
    """per frame: summed gust amplitude (lin re WIND_G) and its 0..1 'brightness'"""
    amp = np.zeros_like(tf); br = np.zeros_like(tf); fcg = np.ones_like(tf) * 2400
    for t0, t1_, db, pw, fc, rel in GUSTS:
        u = np.clip((tf - t0) / (t1_ - t0), 0, 1); e = np.where(tf <= t1_, u ** pw, np.exp(-(tf - t1_) / rel))
        e[tf < t0] = 0; amp += dbl(db) * e; sel = e > br; fcg[sel] = fc; br = np.maximum(br, e)
    return amp, br, fcg
def wind_gain(tf, f, c):
    r = R('wind%d' % c); nf = len(tf)
    base = dbl(curve(WIND_DB, tf) + 2.2 * fwander(r, nf, 70))          # slow gusting even between the gusts
    gamp, gbr, gfc = gust_env(tf)
    fc = curve(WIND_FC, tf) * (gfc / curve(WIND_FC, tf)) ** gbr * 2 ** (.25 * fwander(r, nf, 50))
    F = np.maximum(f, 1.)[:, None]
    body = (F / 100) ** -.5 * (F / WIND_HP) ** 4 / (1 + (F / WIND_HP) ** 4) / (1 + (F / fc[None, :]) ** 2)
    body /= np.sqrt(np.mean(body ** 2, 0, keepdims=True))
    G = body * (base + gamp)[None, :]
    wf = curve(WHISTLE_F, tf) * (1 + .45 * gbr) * 2 ** (.12 * fwander(r, nf, 90))
    wa = dbl(curve(WHISTLE_DB, tf) + 2 * fwander(r, nf, 40)) * (1 + WHISTLE_GUST * gbr) * (base + gamp)   # howl re the body
    for mul, g in [(1., 1.), (1.47, .5)]:
        bw = wf * mul * .05
        gs = np.exp(-.5 * ((F - wf[None, :] * mul) / bw[None, :]) ** 2)
        G += g * wa[None, :] * gs / np.sqrt(np.mean(gs ** 2, 0, keepdims=True) + 1e-12)
    return G * dbl(WIND_G)
WIND = tame(shaped_noise(wind_gain, 'wind'))
PLACE += WIND

# the faint air of the map (quiet paper) that carries through the silence
r = R('air'); air = np.stack([lp(hp(r.standard_normal(N), 140), 3800) for _ in range(2)], 1)
PLACE += urms(air) * dbl(AIR_G + curve(AIR_DB, TT))[:, None]

# sea: a wash, waves rising to their crests (the first one is the spray on the whiteout), shingle drawn back after each
def wave_env(tf, tc, rise, decay):
    u = np.clip((tf - (tc - rise)) / rise, 0, 1); return np.where(tf <= tc, u ** 2, np.exp(-(tf - tc) / decay))
WV = [(A['w4'] + o, db, ri, de) for o, db, ri, de in WAVES]
def sea_gain(tf, f, c):
    F = np.maximum(f, 1.)[:, None]
    wash = dbl(curve(SEA_WASH, tf)) * (1 + .3 * np.sin(2 * np.pi * tf / 4.2 + c * .7))
    sh = (F / 100) ** -.4 * (F / 90) ** 4 / (1 + (F / 90) ** 4) / (1 + (F / 700) ** 2)
    G = sh / np.sqrt(np.mean(sh ** 2)) * wash[None, :]
    for tc, db, ri, de in WV:
        e = wave_env(tf, tc, ri, de); fc = 900 + 6500 * e
        br = (F / 200) ** -.25 * (F / 110) ** 4 / (1 + (F / 110) ** 4) / (1 + (F / fc[None, :]) ** 2)
        G += br / np.sqrt(np.mean(br ** 2, 0, keepdims=True)) * (dbl(db) * e)[None, :] * 1.6
    return G * dbl(SEA_G)
PLACE += tame(shaped_noise(sea_gain, 'sea'))
r = R('shingle'); sks = kernels(r, 5, 1800, 9000, [.4, .7, 1.1, 1.6, 2.4])
for k, (tc, db, ri, de) in enumerate(WV):
    for c in range(2):
        d = 2.2; n = sec(d); rate = 700 * np.exp(-np.linspace(0, d, n) / .7) * np.clip(np.linspace(0, d, n) / .35, 0, 1)
        tg = np.nonzero(r.random(n) < rate / SR)[0] / SR
        x2 = np.zeros((n, 2)); x2[:, c] = scatter(n, tg, r.uniform(.2, 1, len(tg)), sks, r)
        put2(PLACE, x2, tc + .55, SHINGLE_G + db + 12)
fade_place = np.ones(N); i0, i1 = sec(A['fade']), sec(A['fadeEnd'] + .2)
fade_place[i0:i1] = np.cos(np.linspace(0, np.pi / 2, i1 - i0)) ** 2; fade_place[i1:] = 0
PLACE *= fade_place[:, None]

# the ice: groans (stick-slip on low resonances + a slow tonal moan) and the hull creaking
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
def creak(r, d, rate=(28, 85)):
    n = sec(d); u = tv(n) / d
    x = fftconvolve(stickslip(r, n, rate), resonator(r, [(430, .014, 1), (870, .01, .8), (1450, .007, .6), (2400, .005, .4), (3300, .003, .25)], .1))[:n]
    env = np.sin(np.pi * u) ** .8 * (.6 + .4 * np.abs(np.sin(np.pi * u * r.uniform(1.5, 3))))
    x = hp(x, 250) * env; return urms(x, env > .3)
def snap(r):
    n = sec(.25); t = tv(n)
    x = hp(r.standard_normal(n), 1500) * np.exp(-t / .0015) + .35 * np.sin(2 * np.pi * r.uniform(2600, 4200) * t) * np.exp(-t / .02)
    return unit(lp(x, 6000))
r = R('ice'); i0, idur = ICE['t'], ICE['dur']
for fr, d, pan, db in ICE_GROANS: put(PLACE, tame(groan(r, d), 3.2, 3), i0 + fr * idur, ICE_G + db, pan)
for fr, d, pan, db in ICE_CREAKS: put(PLACE, tame(creak(r, d), 3.2, 3), i0 + fr * idur, ICE_G + db, pan)
for fr, pan, db in ICE_SNAPS: put(PLACE, snap(r), i0 + fr * idur, ICE_G + 10 + db, pan)
(wa, wo), d, pan, db = WRECK_GROAN; put(PLACE, tame(groan(r, d, (50, 92), (7, 18), .5), 3.2, 3), T(wa, wo), ICE_G + db, pan)
for (wa, wo), d, pan, db in WRECK_CREAKS: put(PLACE, tame(creak(r, d, (22, 70)), 3.2, 3), T(wa, wo), ICE_G + db, pan)
print('place %.1f s' % (time.time() - t1))

# ═══════════════════════════════ 3. FOLEY + TRANSITIONS ═══════════════════════════════
t1 = time.time()
FX = bus()
# the page settles
def paper_page(r):
    d = 1.2; n = sec(d); t = tv(n); land = PAGE_LAND; after = np.clip(t - land, 0, None)
    air_ = bp(r.standard_normal(n), 300, 2600) * np.clip(t / land, 0, 1) ** 2 * np.exp(-after / .05)
    slap = hp(r.standard_normal(n), 900) * np.exp(-after / .012) * (t >= land)
    thud = lp(r.standard_normal(n), 220) * np.exp(-after / .03) * (t >= land)
    ct = np.concatenate([r.uniform(.05, land, 22), land + r.exponential(.13, 48)]); ct = ct[ct < d - .02]
    cr = scatter(n, ct, r.uniform(.2, 1, len(ct)) * np.exp(-np.clip(ct - land, 0, None) / .25), kernels(r, 5, 1800, 9000, [1.2, 2, 3.5, 5, 8]), r)
    return unit(unit(air_) * .3 + unit(slap) * .45 + unit(thud) * .8 + unit(cr) * .55)
r = R('page'); put(FX, paper_page(r), A['page'], PAGE_G, -.1)

# pen scratches: noise in the paper's band, roughened by the fibre and the paper's tooth, following the stroke's speed
def pen(r, dur, ease, band, gate=None, rough=.8, rub=.2):
    n = sec(dur); u = np.linspace(0, 1, n); sp = speed(ease, u) ** .7
    fibre = np.abs(lp(r.standard_normal(n), 70)); fibre /= fibre.max()
    nt = int(dur * 900); tooth = scatter(n, r.uniform(0, dur, nt), r.uniform(.3, 1, nt), kernels(r, 3, *band, [.3, .5, .8]), r)
    x = (unit(bp(r.standard_normal(n), *band)) * (.4 + rough * fibre) + unit(tooth) * .5 + unit(bp(r.standard_normal(n), 350, 1200)) * rub) * sp
    if gate is not None: x *= gate
    x = tame(x * edges(n, .004, .012), 3.0, 3.0)
    return urms(x, sp > .3)
for i, e in enumerate(PENS):
    r = R('pen%d' % i); gate = None
    if i == 1:                                                  # the drift line is dashed
        k = EASE['ss'](np.linspace(0, 1, sec(e['dur']))) * DRIFT_DASHES
        gate = np.clip(lp(((k % 1) < 14 / 26).astype(float), 250), 0, 1)
    put(FX, pen(r, e['dur'], PEN_EASE[i], PEN_BAND[i], gate, rough=.8 if i == 0 else .5), e['t'], PEN_G[i], -.15 if i == 0 else .1)
r = R('route'); put(FX, pen(r, ROUTE['dur'], ROUTE_EASE, ROUTE_BAND, rough=.9, rub=.3), ROUTE['t'], ROUTE_G, .15)

# type ticks: n characters over dur
def tick(r, f=(2800, 4200), tau=.0009, hpf=2000):
    n = sec(.008); t = tv(n)
    return unit(hp(r.standard_normal(n), hpf) * np.exp(-t / tau) + .5 * np.sin(2 * np.pi * r.uniform(*f) * t) * np.exp(-t / .0016))
r = R('type')
for e in TYPES:
    for i in range(e['n']):
        put(FX, tick(r), e['t'] + i * e['dur'] / e['n'] + r.normal(0, .0015), TICK_G + r.uniform(-4, 0), r.uniform(-.15, .15))
# count-up: one counter tick per step of the displayed value (the picture eases out: eo), and a soft flutter under it
r = R('count')
for i, e in enumerate(COUNTS):
    vals = np.arange(COUNT_STEP[i] / 2, COUNT_TO[i], COUNT_STEP[i])
    tk = e['t'] + (1 - (1 - vals / COUNT_TO[i]) ** (1 / 3)) * e['dur']
    keep = [tk[0]]
    for t_ in tk[1:]:
        if t_ - keep[-1] > .016: keep.append(t_)
    for t_ in keep:
        put(FX, tick(r, (1500, 2500), .0012, 1200), t_, COUNT_G[i] + r.uniform(-3, 0), r.uniform(-.1, .1))
    n = sec(e['dur']); dens = np.zeros(n); np.add.at(dens, np.clip(((tk - e['t']) * SR).astype(int), 0, n - 1), 1.)
    dens = uniform_filter1d(dens, sec(.06)) * SR * .06; dens /= dens.max()
    fl = bp(r.standard_normal(n), 1500, 5000) * dens * edges(n, .01, .08)
    put(FX, urms(fl, dens > .2), e['t'], COUNT_G[i] - 12)

# the air swell into the print (short; a breath, not a riser)
def air_swell(r, d, tail=.6, rise=None):
    n = sec(d + tail); t = tv(n); r0 = d - min(d, rise or d); u = np.clip((t - r0) / (d - r0), 0, 1)
    env = u ** 1.8 * np.exp(-np.clip(t - d, 0, None) / (tail / 3))
    out = []
    for c in range(2):
        lo_, hi_ = bp(r.standard_normal(n), 200, 900), bp(r.standard_normal(n), 900, 3500)
        out.append((unit(lo_) * (1 - .6 * u) + unit(hi_) * u * .7) * env)
    out = np.stack(out, 1); return out / rms(out[sec(d * .8):sec(d)])
e = one('swell'); put2(FX, air_swell(R('swell'), e['dur'], rise=SWELL_RISE), e['t'], SWELL_G)

# the timber crack under the red word
def crack(r):
    d = 1.3; n = sec(d); t = tv(n)
    snap_ = hp(r.standard_normal(n), 600) * np.exp(-t / .0022)
    body = sum(a * np.sin(2 * np.pi * f * r.uniform(.96, 1.04) * t + r.uniform(0, 6.3)) * np.exp(-t / tau)
               for f, a, tau in [(165, 1, .06), (380, .8, .04), (700, .6, .028), (1250, .45, .016), (2300, .3, .009)])
    st = .004 + r.exponential(.09, 34); st = st[st < .6]
    spl = scatter(n, st, r.uniform(.3, 1, len(st)) * np.exp(-st / .14), kernels(r, 4, 1400, 7500, [1, 1.6, 2.5, 4]), r)
    thud = np.sin(2 * np.pi * np.cumsum(70 - 22 * np.clip(t / .25, 0, 1)) / SR) * np.exp(-t / .11) + lp(r.standard_normal(n), 260) * np.exp(-t / .035) * .7
    crunch = bp(r.standard_normal(n), 280, 4500) * np.exp(-t / .03) * (1 + .6 * np.abs(lp(r.standard_normal(n), 120)) / .1)
    x = unit(snap_) * .7 + unit(body) * .55 + unit(spl) * .45 + unit(thud) * .75 + unit(crunch) * .6
    y = x.copy()
    for dl, g, fc in [(.105, .22, 2600), (.185, .13, 1900), (.29, .07, 1400)]:   # the ice field throws it back
        k = sec(dl); y[k:] += lp(x, fc)[:n - k] * g
    return unit(y)
put(FX, crack(R('crack')), A['crack'], CRACK_G, CRACK_PAN)

# the hits: a felt thump when 1,300 km lands, a low one (with 2nd/3rd harmonics) when 28 lands
def hit_sound(r, f0, f1, tau, d, harm, click):
    n = sec(d); t = tv(n); f = f1 + (f0 - f1) * np.exp(-t / .06); ph = 2 * np.pi * np.cumsum(f) / SR
    x = (np.sin(ph) + harm[0] * np.sin(2 * ph) * np.exp(-t / (tau * .6)) + harm[1] * np.sin(3 * ph) * np.exp(-t / (tau * .4))) * np.exp(-t / tau)
    x += click * lp(r.standard_normal(n), 900) * np.exp(-t / .006)
    x *= edges(n, .0005, min(.08, d * .4)); return unit(x)
r = R('hits')
put(FX, hit_sound(r, 66, 52, .07, A['sil'] - A['hit1'], (.25, .1), .3), A['hit1'], HIT_G[0], 0)   # gone before the silence
put(FX, hit_sound(r, 52, 40, .5, 2.4, (.32, .14), .25), A['hit2'], HIT_G[1], 0)
print('foley %.1f s' % (time.time() - t1))

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
def master_hp(x): return np.stack([hp(x[:, c], 30, 2) for c in range(2)], 1)
endf = np.ones(N); endf[-sec(END_FADE):] = np.cos(np.linspace(0, np.pi / 2, sec(END_FADE))) ** 2
STEMS = {'music': master_hp(MUSIC) * MGATE[:, None], 'place': master_hp(PLACE * dbl(G_PLACE)), 'fx': master_hp(FX * dbl(G_FX))}
for k in STEMS: STEMS[k] *= endf[:, None]
mix = STEMS['music'] + STEMS['place'] + STEMS['fx']
RAW_I, RAW_LRA = loudness(mix); RAW_TP = 20 * np.log10(true_peak(mix))
ceil_db = min(TP_MAX, TARGET_I + PLR_MAX)
G = dbl(TARGET_I - RAW_I); sc = ceil_db - .3        # sample-peak ceiling of the safety limiter
for it in range(10):                      # normalise; limit only the peaks that pass the ceiling; re-measure
    out, LIM = limit(mix * G, dbl(sc))
    I_, _ = loudness(out); TP_ = 20 * np.log10(true_peak(out))
    if TP_ > ceil_db: sc -= TP_ - ceil_db + .05
    elif abs(I_ - TARGET_I) > .03: G *= dbl(TARGET_I - I_)
    else: break
mix = out
mix = mix[:N]
sf.write(os.path.join(OUT, 'mix.wav'), mix.astype(np.float32), SR, subtype='PCM_24')
ST = {k: x * G * LIM[:, None] for k, x in STEMS.items()}
for k, x in ST.items(): sf.write(os.path.join(OUT, 'stems', k + '.wav'), x.astype(np.float32), SR, subtype='FLOAT')
print('master %.1f s' % (time.time() - t1))
T_RUN = time.time() - T_START

# ═══════════════════════════════ 5. CHECKS ═══════════════════════════════
def db(x): return 20 * np.log10(np.sqrt(np.mean(np.square(np.asarray(x, float)))) + 1e-12)
def pdb(x): return 20 * np.log10(np.abs(np.asarray(x, float)).max() + 1e-12)
I_out, LRA_out = loudness(mix); TP_out = 20 * np.log10(true_peak(mix))
print('\nwrote %s  %d samples = %.4f s (dur %.4f), %d Hz stereo, PCM 24' % (os.path.join(OUT, 'mix.wav'), len(mix), len(mix) / SR, DUR, SR))
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
print('OUT (own meter): I %.2f LUFS · LRA %.1f LU · true peak %.2f dBTP · TP − I %.1f dB · sample peak %.2f dBFS · clipped %d'
      % (I_out, LRA_out, TP_out, TP_out - I_out, pdb(mix), int((np.abs(mix) >= 1).sum())))
# ffmpeg's own meters: ebur128 and loudnorm's first pass with mux.sh's settings
try:
    p = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', os.path.join(OUT, 'mix.wav'), '-af', 'ebur128=peak=true',
                        '-f', 'null', '-'], capture_output=True, text=True)
    s = p.stderr[p.stderr.rfind('Summary:'):]
    fI = float(re.search(r'I:\s+(-?[\d.]+) LUFS', s).group(1)); fL = float(re.search(r'LRA:\s+(-?[\d.]+) LU', s).group(1))
    fTP = float(re.search(r'Peak:\s+(-?[\d.]+) dBFS', s).group(1))
    print('OUT (ffmpeg ebur128): I %.1f LUFS · LRA %.1f LU · true peak %.1f dBFS' % (fI, fL, fTP))
    p = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', os.path.join(OUT, 'mix.wav'), '-af',
                        'loudnorm=I=-14:TP=-1.2:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True)
    J = json.loads(p.stderr[p.stderr.rfind('{'):p.stderr.rfind('}') + 1])
    off_tp = float(J['input_tp']) + (-14 - float(J['input_i']))
    lin = off_tp <= -1.2 and float(J['input_lra']) <= 11
    print('mux.sh loudnorm pass 1: input I %s, TP %s, LRA %s → after +%.1f dB the peak would be %.1f dBTP → %s'
          % (J['input_i'], J['input_tp'], J['input_lra'], -14 - float(J['input_i']), off_tp, 'LINEAR (peaks kept)' if lin else 'DYNAMIC'))
except Exception as ex:
    print('ffmpeg meters failed:', ex)
# the silence
s0, s1 = sec(A['sil']), sec(A['silEnd']); m = ST['music'][s0:s1]
print('SILENCE %.2f–%.2f s (%.2f s): music stem peak %s dBFS, RMS %s dBFS → %s; whole mix there: RMS %.1f dBFS, peak %.1f dBFS'
      % (A['sil'], A['silEnd'], A['silEnd'] - A['sil'], '%.1f' % pdb(m) if np.abs(m).max() > 0 else '-inf',
         '%.1f' % db(m) if np.abs(m).max() > 0 else '-inf', 'OK (≤ −50)' if pdb(m) <= -50 else 'NOT SILENT',
         db(mix[s0:s1]), pdb(mix[s0:s1])))
# onsets: where the energy jumps most within ±0.1 s of each cue, in the stem that carries it and in the finished mix
def onset(x, t, look=.1, w=.01, hpf=200):
    """where the energy (above hpf) jumps most within ±look s: max of (mean square over the next w) / (over the previous 2w)"""
    y = hp(x.mean(1), hpf, 2) if hpf else x.mean(1); c = np.concatenate([[0.], np.cumsum(y ** 2)]); n = sec(w)
    i = np.arange(sec(t - look), sec(t + look)); post = (c[i + n] - c[i]) / n; pre = (c[i] - c[i - 2 * n]) / (2 * n)
    return i[int(np.argmax(post / (pre + 1e-14)))] / SR
FR = 1000 / 24
print('\ncue alignment, one frame = %.1f ms' % FR)
print(' foley / hits: largest 10 ms energy jump (above 200 Hz) within ±0.1 s, in their own stem and in the finished mix:')
for name, t, stem in [('hit soft (1,300 km)', A['hit1'], 'fx'), ('hit low (28)', A['hit2'], 'fx'), ('timber crack', A['crack'], 'fx'),
                      ('page touches down', A['page'] + PAGE_LAND, 'fx'), ('timpani+drum (wreck)', A['w2'], 'perc'), ('timpani+drum (28)', A['hit2'], 'perc')]:
    o1, o2 = onset(ST[stem] if stem in ST else FAM[stem], t), onset(mix, t); d1, d2 = 1000 * (o1 - t), 1000 * (o2 - t)
    print('  %-22s event %6.3f  %-5s %6.3f (Δ %+6.1f ms)  mix %6.3f (Δ %+6.1f ms)  %s' % (name, t, stem, o1, d1, o2, d2,
          'ok' if abs(d1) <= FR and abs(d2) <= FR else 'stem ok, masked in the mix' if abs(d1) <= FR else 'OFF'))
print(' music hits: placed on the event; attack of the sample itself (first sample above −20 dB of its peak):')
for name, t, la in MLOG:
    print('  %-28s event %6.3f  attack %6.3f  Δ %+6.1f ms  %s' % (name, t, t + la, 1000 * la, 'ok' if 1000 * la <= FR else 'OFF'))
print(' gust peaks (wind layer above 1.2 kHz, 50 ms RMS, maximum between the gust start and whiteout + 0.3 s):')
wh = WIND * G * LIM[:, None]; wh = np.stack([hp(wh[:, c], 1200, 4) for c in range(2)], 1)   # above the howl (narrowband, its envelope wanders)
env = np.sqrt(uniform_filter1d(wh ** 2, sec(.05), axis=0).mean(1))
for g0, g1_, *_ in GUSTS:
    a, b = sec(g0), sec(g1_ + .3); i = a + int(np.argmax(env[a:b]))
    print('  gust %5.2f → whiteout %5.2f: peak at %6.3f (Δ %+5.1f ms)' % (g0, g1_, i / SR, 1000 * (i / SR - g1_)))
SCN = [('black + newspaper', 0, A['into']), ('portrait', A['into'], A['w1']), ('ice (night)', A['w1'], A['w2']),
       ('wreck', A['w2'], A['w3']), ('map', A['w3'], A['sil']), ('silence', A['sil'], A['silEnd']),
       ('dive', A['silEnd'], A['w4']), ('beach before 28', A['w4'], A['hit2']), ('beach after 28', A['hit2'], A['fade']),
       ('fade + tail', A['fade'], DUR)]
zk = (kweight(mix) ** 2).sum(1); ck = np.concatenate([[0.], np.cumsum(zk)]); nm4 = sec(.4)
MOM = -.691 + 10 * np.log10((ck[nm4:] - ck[:-nm4]) / nm4 + 1e-20)          # momentary loudness, window ending at each sample
print('\nscene                RMS dBFS:  mix   music   place   fx    | mix peak | max momentary LUFS (at) | limiter: max dB, % of samples')
for nm, a, b in SCN:
    sl = slice(sec(a), sec(b)); gl = LIM[sl]
    m_ = MOM[max(0, sec(a) - nm4 + sec(.2)):max(1, sec(b) - nm4 + sec(.2))]; im = int(np.argmax(m_))
    print('  %-18s %6.1f %7.1f %7.1f %6.1f   | %6.1f   | %6.1f (%5.2f s)        | %4.1f  %5.2f' % (nm, db(mix[sl]), db(ST['music'][sl]), db(ST['place'][sl]), db(ST['fx'][sl]),
          pdb(mix[sl]), m_[im], (max(0, sec(a) - nm4 + sec(.2)) + im + nm4) / SR - .2, -20 * np.log10(gl.min()), 100 * (gl < .999).mean()))
# bands: is the low end in check? (TECHNIQUE §5: 20–120 Hz about −3 dB relative to the rest)
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
        if e['type'] in ('whiteout', 'hit', 'crack', 'silence', 'note', 'fade'):
            dr.line([X(e['t']), Tp, X(e['t']), 780], fill=(200, 120, 120) if e['type'] != 'silence' else (120, 120, 200))
            dr.text((X(e['t']) + 2, 785 if e['type'] != 'whiteout' else 798), e['type'], fill=(150, 60, 60))
    sx = (A['sil'], A['silEnd']); dr.rectangle([X(sx[0]), Tp + 1, X(sx[1]), 779], outline=(90, 90, 200))
    z = (kweight(mix) ** 2).sum(1); cs = np.concatenate([[0.], np.cumsum(z)])
    def lk(w, t):
        i1_ = np.clip((t * SR).astype(int), 1, N); i0_ = np.clip(i1_ - sec(w), 0, N); return -.691 + 10 * np.log10((cs[i1_] - cs[i0_]) / np.maximum(i1_ - i0_, 1) + 1e-12)
    ts = np.arange(0, DUR, .02)
    for w, col, y0, y1, v0, v1 in [(.4, (150, 150, 150), Tp, 360, -45, -5), (3., (20, 20, 20), Tp, 360, -45, -5)]:
        v = np.clip(lk(w, ts), v0, v1); pts = [(X(t), y1 - (vv - v0) / (v1 - v0) * (y1 - y0)) for t, vv in zip(ts, v)]; dr.line(pts, fill=col, width=2)
    y = Tp + 330 - (TARGET_I + 45) / 40 * 330; dr.line([L, y, Wp - Rm, y], fill=(60, 160, 60)); dr.text((Wp - 160, y - 14), 'target %.0f LUFS' % TARGET_I, fill=(60, 140, 60))
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
