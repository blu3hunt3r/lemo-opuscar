"""Wing C: the sound of the tape → out/mix.wav (48 kHz stereo float, exactly events.json `dur` long).

No score (STYLE.md §7): only what a 1995 camcorder mic in a school corridor would record.
Every sound sits on a time from events.json (exported from the picture's window.EV); the fluorescent
bed follows the picture's 50 Hz `track` rows (camera z + every light layer's level).

Layers (knobs in the PARAMETERS block, one group per layer):
  1. HUM_*    fluorescent bed: per-panel level × distance → a bright near share (120 Hz hum, ballast buzz,
              9 kHz whine), a dark far share (corridor wash) and a muffled, wide classroom share
  2. ROOM_*   ventilation / air / camcorder self-noise + tape hiss
  3. DRONE_*  brown-noise band + two beating low sines, rising from the approach to the hush, never back
  4. FX_*     foley: strikes (relay, two tinks, flicker sputter on the picture's own flicker pattern),
              offs (relay + hum release), classrooms, sensor LEDs, vinyl-tile steps, cloth, crouch,
              camcorder (REC clack + motor, zoom servo, AF), the restrike thunk.
              Placed by distance: dry gain + low-pass + two corridor reverbs (VERB_*), farther = wetter/darker
  5. BR_*     breathing that follows fear, the held breath, the gasp, one long exhale
  6. RIDE / SOFT / PLR  the re-recording pass: a scene-level fader ride, a memoryless soft clip (the
              camcorder preamp overloading on the few hot transients) and a linked look-ahead safety limiter,
              so that mux.sh's two-pass loudnorm can scale this mix LINEARLY: that needs LRA ≤ 11 LU and
              true peak ≤ I + 12.8 dB, otherwise loudnorm drops to its dynamic mode and rides the silences
Then the hush window is set to digital zero (tails included) and the checks print.

Run from the library root:  .venv/bin/python films/wing-c/mix.py
"""
import os, sys, json, time
T_START = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get('LIB') or os.path.abspath(os.path.join(HERE, '..', '..'))   # the library (build.sh exports LIB)
sys.path.insert(0, ROOT)
import numpy as np, soundfile as sf
from scipy.signal import oaconvolve, lfilter, resample_poly, hilbert
from scipy.fft import next_fast_len
from scipy.ndimage import uniform_filter1d, maximum_filter1d, minimum_filter1d
from core.audio.sfx import SR, bp, lp, hp, add

OUT = os.environ.get('OUT') or os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)

# ═══════════════════════════════ PARAMETERS ═══════════════════════════════
SEED = 1995
H_MIC = 1.2                 # m between the camcorder mic and the ceiling fixtures
NCOR = 27                   # corridor panels F0…F26 (z = 1.2 − 2.4 k)

# 1 — fluorescent hum bed
HUM_NEAR_POW = 1.9          # near share ∝ (1.2/d)^pow per panel (power-summed): steep, so only close panels are bright
HUM_FAR_POW = 0.8           # far share ∝ (1.2/d)^pow: gentler, the corridor carries it
HUM_NEAR_G = 0.040          # near share level (≈ RMS under one lit panel)
HUM_FAR_G = 0.0050          # far share level, per unit of far envelope
HUM_ROOMS_G = 0.016         # classrooms through the doorways (muffled, wide)
HUM_HARM = [                # per panel group (k % 3): relative amplitude of 120, 240, 360, 480, 600, 720 Hz
    [1.0, .55, .30, .16, .10, .05],
    [1.0, .70, .45, .25, .15, .08],
    [.9, .50, .38, .30, .20, .12]]
HUM_BUZZ = [.22, .40, .30]  # ballast buzz (120 Hz pulse train, band-passed) per group, relative to the hum
HUM_BUZZ_BAND = [(450, 2800), (600, 3600), (380, 2400)]
HUM_FIZZ = .05              # arc fizz (noise gated by the 120 Hz pulses, 2.5–7 kHz)
HUM_WHINE = .022            # ~9.15 kHz ballast whine (near share only)
HUM_BADTUBE = .55           # occasional bad-tube buzz swells on group-2 panels (acoustic only)
HUM_SMOOTH = .006           # s, smoothing of the 50 Hz envelopes after interpolation
HUM_NEAR_SEND = .25         # near share → near corridor reverb
HUM_FAR_SEND = .25          # far share → far corridor reverb
HUM_ROOMS_SEND = .5         # classroom share → far reverb

# 2 — room tone
ROOM_AIR = .0017            # ventilation rumble (brown noise < 260 Hz)
ROOM_GRILLE = .00045        # air through grilles (250–1400 Hz)
ROOM_CAM = .00018           # camcorder transport self-noise (30 Hz drum ripple on 0.7–2.6 kHz)
ROOM_HISS = .0007           # tape / preamp hiss (> 4 kHz)
ROOM_BLANK = 2.5            # hiss level after REC off (blank tape), × ROOM_HISS

# 3 — drone
DRONE_LEAD = 0.0            # s relative to the first far strike of the approach, where it starts rising
DRONE_G = .0105             # level at its peak (just before the hush)
DRONE_SHAPE = 1.4           # rise curve exponent
DRONE_F = (55.0, 55.65)     # two beating sines (0.65 Hz beat)

# 4 — foley + distance + reverb
FX_DRY_SLOPE = 4.0          # dB lost per doubling of distance (dry; a corridor carries sound like a waveguide)
FX_WET0 = -12.0             # dB reverb send at 1.2 m
FX_WET_SLOPE = 1.0          # dB lost per doubling of distance (wet)
FX_FAR_D = (4.0, 26.0)      # m: reverb send crossfades near IR → far IR over this range
FX_LP = (16000, 5.0)        # dry low-pass cutoff = a / (1 + d / b)
FX_STRIKE = .26             # one panel's strike (relay + tinks + sputter) at 1.2 m
FX_TINK = .55
FX_SPUTTER = .30
FX_SPUTTER_WET = .35         # the sputter's reverb send relative to the onset's (keeps the corridor wash from burying the clunks)
FX_STRIKE_ALL = 1.1         # each panel's strike in the restrike, × FX_STRIKE
FX_RELAY_ALL = .3           # its relay clunk (the thunk carries the weight)
FX_OFF = .22                # relay click off at 1.2 m
FX_OFF_HUM = .45            # the hum release inside an 'off'
FX_ROOMS = .10              # each classroom relay, through a doorway
FX_ROOMS_N = 14             # classrooms heard switching
FX_LED = .07                # sensor tick at 1.2 m
FX_LED_SLOPE = 8.0          # dB per doubling: only audible close
FX_STEP = .21               # heel tap at v = 1
FX_SQUEAK_P = .3            # chance of a rubber squeak per step
FX_RUSTLE = .045
FX_CROUCH = .07
FX_ZOOM = .011
FX_AF = .010
FX_REC = .09                # camcorder clack
FX_MOTOR = .02              # tape transport spin-up / down
FX_THUNK = .19              # the restrike: every relay in the wing at once
FX_THUNK_SENDS = (.10, .08) # its near / far reverb sends (above 90 Hz: the sub doesn't boom on)
VERB_NEAR = dict(rt=1.35, dur=2.4, pre=.006, att=.004, flutter=.32, dark=1.0)
VERB_FAR = dict(rt=2.3, dur=3.6, pre=.028, att=.07, flutter=.12, dark=.45)

# 5 — breathing (close mic, dry)
BR_G = .016                 # overall breath level
# fear curve: time (s), period (s), gain, shakiness — interpolated; breathing stops inside BR_STOP zones
BR_ANCH = np.array([
    [1.6, 4.2, .10, 0.], [20.0, 4.0, .12, 0.], [23.6, 2.6, .38, .15], [27.0, 2.1, .62, .35],
    [28.4, 2.0, .55, .35], [33.0, 1.6, .5, .3], [38.5, 1.35, .55, .35], [44.25, 1.0, .85, .45],
    [45.5, 1.3, .6, .4], [46.4, 2.3, .3, .2], [50.0, 2.5, .25, .2], [53.6, 2.2, .45, .3], [56.0, 2.0, .55, .35], [59.0, 1.8, .6, .35]])
# times below are (anchor, offset s); anchors come from events.json (see ANCHORS), so they follow a retimed picture
BR_STOP = [(('dark', .1), ('approach', .6)),      # near-silence, then listening for the distant clunk
           (('holdBreath', -.05), ('gasp', .75)), # the held breath
           (('exhale', -.35), ('out', 1.2)),      # the long exhale, then watching the lights go
           (('recoff', -.25), ('end', 40))]       # REC off
BR_EXTRA = [(('dark', .12), .55, .62, .62, .4)]   # (at, in, out, gain, shaky): one short shaky breath in the near-silence
BR_GASP = 2.2               # × BR_G
BR_EXHALE = 2.0
BR_CATCH = .9

# master
MASTER_G = 1.0
MASTER_HP = 32              # Hz, sub / DC
MASTER_LP = 14500           # Hz, the camcorder mic's top
CEIL_DB = -1.3              # absolute limiter ceiling, dBFS
# fader ride: (anchor, offset s, dB), linear between points; a 5 ms pair makes a step. Lifts the quiet scenes
# (approach, ending: like a camcorder ALC creeping up in the dark), dips after the restrike like an ALC recovering,
# so the loudness range stays ≤ 11 LU and mux.sh's loudnorm stays linear
RIDE = [('start', 0, 0), ('walk', -.5, 0), ('walk', 1.0, -1.5), ('dark', -4.0, -1.5), ('dark', -.5, 1), ('dark', .3, 2.5),
        ('approach', 0, 4.5), ('approach', 1.1, 7), ('approach', 2.6, 7.5), ('approach', 7.6, 5.5),
        ('hush0', 0, 5), ('hush1', 0, 3), ('restrike', -.005, 3), ('restrike', 0, 0), ('restrike', .7, 0),
        ('restrike', 1.4, -3), ('restrike', 3.1, -1.5), ('out', -.4, -1.5), ('out', .6, -1), ('out', 1.2, 1),
        ('out', 2.1, 4.5), ('out', 3.1, 7), ('out', 4.6, 8), ('end', 0, 8)]
SOFT_KNEE = 2.5             # dB below the ceiling where the soft clip starts bending
PLR_MAX = 11.6              # dB: first sample-peak ceiling = integrated loudness + this
PLR_TP = 12.2               # dB: true peak − integrated loudness allowed (loudnorm's linear limit is 12.8; ffmpeg reads I ~0.2 lower)
END_FADE = .25              # s, master fade at the very end (cuts the last reverb tail cleanly)
HUSH_FADE = .006            # s: fade just before the digital zero (avoids a click; reads as a cut)
BED_RETURN = (.05, .9)      # s after the hush: delay, fade-in of room tone + hum (the LED tick comes first)

# ═══════════════════════════════ EVENTS ═══════════════════════════════
rng = np.random.default_rng(SEED)
E = json.load(open(os.path.join(HERE, 'events.json')))
DUR = float(E['dur']); EV = E['ev']
N = int(round(DUR * SR))
tt = np.arange(N) / SR
ev = lambda ty: [e for e in EV if e['type'] == ty]
one = lambda ty: ev(ty)[0]
def sec(d): return int(round(d * SR))
def nz(n): return rng.standard_normal(n)
def tv(n): return np.arange(n) / SR
def dec(n, tau): return np.exp(-tv(n) / tau)
def unit(x): m = np.abs(x).max(); return x / m if m > 0 else x
def rmsn(x): r = np.sqrt((x ** 2).mean()); return x / r if r > 0 else x
def rotate(x, deg):
    """the same signal with every frequency's phase turned by `deg`: decorrelates L/R without a mono comb"""
    a = hilbert(x, next_fast_len(len(x)))[:len(x)]; th = np.deg2rad(deg)
    return np.real(a) * np.cos(th) - np.imag(a) * np.sin(th)
def wander(n, win):
    """smoothed noise, unit std (for slow drifts and tremor)"""
    w = uniform_filter1d(nz(n), max(1, sec(win))); return w / (w.std() + 1e-12)
def fade(n, fi, fo):
    x = np.ones(n); a, b = min(n, sec(fi)), min(n, sec(fo))
    if a: x[:a] = np.linspace(0, 1, a)
    if b: x[n - b:] *= np.linspace(1, 0, b)
    return x

TRK = one('track'); FPS = TRK['fps']; ROWS = np.array(TRK['rows'], float)
RT = np.arange(len(ROWS)) / FPS
CZ, LV, LROOMS = ROWS[:, 0], ROWS[:, 2:2 + NCOR], ROWS[:, 2 + NCOR]
FZ = 1.2 - 2.4 * np.arange(NCOR)
def cam_z(t): return float(np.interp(t, RT, CZ))
def dist(z, t): return float(np.hypot(z - cam_z(t), H_MIC))

HUSH = one('hush'); H0, H1 = HUSH['t'], HUSH['t'] + HUSH['d']
I0, I1 = sec(H0), sec(H1)
TREC, TOFF = one('recOn')['t'], one('recOff')['t']
# story anchors, all from events.json
_fa = min(e['t'] for e in ev('strike') if e['all'])
_ap = min(e['t'] for e in ev('strike') if not e['all'] and e['t'] > min(e2['t'] for e2 in ev('off')))
ANCHORS = {'start': 0., 'end': DUR, 'rec': TREC, 'recoff': TOFF, 'hush0': H0, 'hush1': H1,
           'walk': ev('step')[0]['t'],                                                   # first step
           'dark': max(e['t'] for e in ev('off') if e['t'] < _ap),                       # last light behind goes off
           'approach': _ap,                                                              # first far strike
           'restrike': _fa,                                                              # every light at once
           'out': min(e['t'] for e in ev('off') if e['t'] > _fa),                        # the lights start going out
           'holdBreath': one('holdBreath')['t'], 'gasp': one('gasp')['t'], 'exhale': one('exhale')['t']}
def at(a): return ANCHORS[a[0]] + a[1]

# the picture's strike curve (story.js strike()) — so tinks and sputter land on the picture's own flicker
def jhash(n):
    n = np.sin(np.asarray(n, float) * 127.1 + 311.7) * 43758.5453
    return n - np.floor(n)
def strike_curve(u, k):
    u = np.asarray(u, float); h1 = jhash(k * 13.7 + 1 * 3.1); h2 = jhash(k * 13.7 + 2 * 3.1)
    v = np.zeros_like(u)
    v[(u >= 0) & (u < .05)] = .18
    m = (u >= .17 + .05 * h1) & (u < .22 + .05 * h1); v[m] = .3
    m = (u >= .22 + .05 * h1) & (u < .3 + .06 * h2); v[m] = .02
    m = (u >= .3 + .06 * h2) & (u < .62); f = np.floor(u[m] * 48 + k); v[m] = np.where(jhash(f * 1.7 + k) < .45, .15, .95)
    m = u >= .62; v[m] = .88 + .12 * (1 - np.exp(-(u[m] - .62) / 1.2))
    return v
def tink2_at(k): return .17 + .05 * float(jhash(k * 13.7 + 3.1))

# sanity: the ported curve must match the exported rows (BASE[k] = .92 + .16 hash(5.3 k + 2))
_dev = 0.0
for e in ev('strike'):
    k = e['k']; i = np.nonzero((RT >= e['t']) & (RT < e['t'] + .6))[0]
    ref = strike_curve(RT[i] - e['t'], k) * (.92 + .16 * float(jhash(k * 5.3 + 2)))
    _dev = max(_dev, float(np.mean(np.abs(ref - LV[i, k]) > .02)))
print('strike curve vs track rows: worst fraction of mismatched rows %.3f' % _dev)

# ═══════════════════════════════ BUSES ═══════════════════════════════
# 'pre' holds everything that starts before the hush (it is cut to zero at the hush, tails and all);
# 'post' everything from the hush's end on. Each: dry, near-reverb send, far-reverb send.
def bus(): return {'dry': np.zeros((N, 2)), 'n': np.zeros((N, 2)), 'f': np.zeros((N, 2))}
BUS = {'pre': bus(), 'post': bus()}
def busfor(t): return BUS['pre'] if t < H0 else BUS['post']
LOG = []   # (type, t, peak of its dry contribution) for the checks

def put(name, x, t, g=1., pan=0.):
    """mono x → bus channel `name` ('dry' | 'n' | 'f') of the right bus"""
    if H0 <= t < H1: return
    add(busfor(t)[name], x, t, g, pan)

def place(x, t, d, g=1., pan=0., slope=FX_DRY_SLOPE, wet=1., muffle=None, tag=None):
    """A sound at distance d (m): quieter and darker dry, relatively wetter, near IR → far IR with distance."""
    if H0 <= t < H1: return
    if muffle: x = lp(x, muffle, 2)
    oct_ = np.log2(max(d, H_MIC) / H_MIC)
    gd = g * 10 ** (-slope * oct_ / 20)
    gw = g * wet * 10 ** ((FX_WET0 - FX_WET_SLOPE * oct_) / 20)
    fc = FX_LP[0] / (1 + d / FX_LP[1])
    xd = lp(x, fc, 2) if fc < 15000 else x
    xw = lp(x, min(15000, fc * 1.6), 1)
    ff = np.clip((d - FX_FAR_D[0]) / (FX_FAR_D[1] - FX_FAR_D[0]), 0, 1)
    put('dry', xd, t, gd, pan)
    put('n', xw, t, gw * np.sqrt(1 - ff), pan * .6)
    put('f', xw, t, gw * np.sqrt(ff), pan * .3)
    if tag: LOG.append((tag, t, gd * np.abs(xd).max(), d))

# ═══════════════════════════════ SOUND SOURCES ═══════════════════════════════
def ballast_buzz(n, ph0=0., sharp=10):
    """magnetic ballast buzz: a 120 Hz pulse train, band-passed, plus arc fizz gated by the same pulses"""
    ph = 2 * np.pi * 120 * tv(n) + ph0
    pu = np.abs(np.sin(ph / 2)) ** sharp
    return rmsn(bp(pu - pu.mean(), 450, 4000)) + rmsn(bp(nz(n) * pu, 2200, 7000)) * .6

def relay_on():
    n = sec(.2); t = tv(n); f0 = rng.uniform(100, 135)
    body = np.sin(2 * np.pi * f0 * t * (1 - .6 * t)) * dec(n, .02)
    thud = lp(nz(n), 600) * dec(n, .012)
    clk = hp(nz(n), 2000) * dec(n, .0018)
    ring = sum(a * np.sin(2 * np.pi * f * t + rng.random() * 6) * dec(n, tau) for f, a, tau in
               [(rng.uniform(700, 950), .45, .014), (rng.uniform(1800, 2400), .3, .009), (rng.uniform(3300, 4300), .18, .006)])
    x = body * .8 + thud * .5 + clk * .35 + ring * .5
    b = sec(rng.uniform(.006, .011)); x[b:] += clk[:n - b] * .2 + ring[:n - b] * .18   # contact bounce
    return unit(x)

def relay_off():
    """lighter than the clunk on: the armature dropping onto its stop in a plastic housing, a spring ring"""
    n = sec(.18); t = tv(n); f0 = rng.uniform(150, 200)
    body = np.sin(2 * np.pi * f0 * t) * dec(n, .014)
    knock = unit(bp(nz(n), 300, 1500) * dec(n, .006))
    clk = hp(nz(n), 2500) * dec(n, .0012)
    ring = sum(a * np.sin(2 * np.pi * f * t + rng.random() * 6) * dec(n, tau) for f, a, tau in
               [(rng.uniform(1100, 1500), .35, .012), (rng.uniform(2600, 3200), .25, .03), (rng.uniform(4500, 5200), .12, .006)])
    x = body * .5 + knock * .8 + clk * .5 + ring * .5
    b = sec(rng.uniform(.004, .008)); x[b:] += knock[:n - b] * .3 + clk[:n - b] * .2
    return unit(x)

def tink():
    n = sec(.09); t = tv(n)
    x = sum(a * np.sin(2 * np.pi * f * t + rng.random() * 6) * dec(n, tau) for f, a, tau in
            [(rng.uniform(3300, 3900), 1., .03), (rng.uniform(5200, 6000), .5, .018), (rng.uniform(7600, 8400), .25, .01)])
    return unit(x + hp(nz(n), 3000) * dec(n, .001) * .5)

def strike_fx(k, relay=1.):
    """relay clunk, a tink on each of the two dim flashes, then a sputtering buzz gated by the picture's flicker.
    Returns (onset, sputter) so they can get different reverb sends."""
    n = sec(.9); u = tv(n); lev = strike_curve(u, k); x = np.zeros(n)
    c = relay_on(); x[:len(c)] += c * relay
    for tu, a in [(0., .45), (tink2_at(k), .6)]:
        tk = tink(); i = sec(tu); x[i:i + len(tk)] += tk * a * FX_TINK
    g = np.where(u < .62, lev, lev * np.exp(-(u - .62) / .05)); g[u < .3] *= .35
    g = uniform_filter1d(g, sec(.0015))
    sp = ballast_buzz(n, rng.random() * 6) * g * FX_SPUTTER * .5
    for i in np.nonzero(np.diff(lev) > .5)[0]:          # every jump up of the flicker ticks
        m = sec(.006); x[i:i + m] += hp(nz(m), 2500) * dec(m, .0008) * .22
    return x, sp

def off_fx():
    """relay click + the panel's hum collapsing (the picture's switchOff: 1 → .15 in 50 ms, then 0.12 s decay)"""
    n = sec(.4); t = tv(n); x = np.zeros(n)
    c = relay_off(); x[:len(c)] += c
    so = np.where(t < .05, 1 - t / .05 * .85, .15 * np.exp(-(t - .05) / .12)) * fade(n, .003, 0)
    hum = np.sin(2 * np.pi * 120 * t) + .6 * np.sin(2 * np.pi * 240 * t + 1) + .3 * np.sin(2 * np.pi * 360 * t + 2)
    x += (rmsn(hum) * .5 + ballast_buzz(n, rng.random() * 6) * .3) * so * FX_OFF_HUM * .5
    return x

def led_tick():
    n = sec(.03); t = tv(n)
    x = hp(nz(n), 3000) * dec(n, .0006) + np.sin(2 * np.pi * rng.uniform(6000, 6800) * t) * dec(n, .004) * .5 \
        + np.sin(2 * np.pi * 1150 * t) * dec(n, .003) * .2
    return unit(x)

def step_fx(v):
    """vinyl tile, hard corridor: heel tap (tile ring + small body), lighter toe, a rubber squeak now and then"""
    n = sec(.32); t = tv(n)
    tile = lambda: sum(a * np.sin(2 * np.pi * f * t + rng.random() * 6) * dec(n, tau) for f, a, tau in
                       [(rng.uniform(1700, 2300), .4, .010), (rng.uniform(3000, 3800), .25, .007), (rng.uniform(650, 850), .3, .014)])
    heel = hp(nz(n), 1200) * dec(n, .0025) * .8 + tile() + np.sin(2 * np.pi * rng.uniform(120, 170) * t) * dec(n, .016) * .7 \
        + lp(nz(n), 400) * dec(n, .01) * .5
    x = unit(heel)
    td = rng.uniform(.045, .075); toe = unit(hp(nz(n), 1800) * dec(n, .0015) + tile() * .5) * .32
    x[sec(td):] += toe[:n - sec(td)]
    if v > .5 and rng.random() < FX_SQUEAK_P:
        d = rng.uniform(.06, .11); m = sec(d); s = tv(m); f0 = rng.uniform(1500, 2600)
        f = f0 * (1 + .18 * s / d) * (1 + .03 * np.sin(2 * np.pi * 28 * s))
        ph = 2 * np.pi * np.cumsum(f) / SR
        sq = (np.sin(ph) + .35 * np.sin(2 * ph)) * np.sin(np.pi * s / d) ** 2 * rng.uniform(.12, .22)
        i = sec(td + rng.uniform(0, .03)); x[i:i + m] += sq[:max(0, min(m, n - i))]
    return x * v ** 1.2

def rustle_fx(v, lo=900, hi=6500):
    d = (.3 + .45 * v) * rng.uniform(.8, 1.2); n = sec(d); u = np.linspace(0, 1, n)
    grain = np.abs(uniform_filter1d(nz(n), sec(.004))); grain /= grain.max()
    env = np.minimum(1, u / .3) * np.minimum(1, (1 - u) / .5) ** 1.5
    x = bp(nz(n), lo, hi) * (.35 + grain * 1.6) * env + lp(nz(n), 500) * env * .3
    return unit(x) * v

def crouch_fx():
    n = sec(1.0); x = np.zeros(n)
    r = rustle_fx(1.0, 500, 4500); x[:len(r)] += r * .8
    m = sec(.05); s = tv(m)                       # knee crack
    pop = hp(nz(m), 1500) * dec(m, .0012) + np.sin(2 * np.pi * 210 * s) * dec(m, .008) * .6
    i = sec(.34); x[i:i + m] += unit(pop) * .9
    m = sec(.09); s = tv(m); f = 1900 * (1 - .2 * s / .09)    # sole creak on the tile as the weight shifts
    sq = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * s / .09) ** 2 * .25
    i = sec(.2); x[i:i + m] += sq
    return x

def clack():
    n = sec(.12); t = tv(n)
    x = hp(nz(n), 1500) * dec(n, .005) + np.sin(2 * np.pi * rng.uniform(170, 210) * t) * dec(n, .022) * .8 \
        + np.sin(2 * np.pi * 1350 * t) * dec(n, .01) * .3
    return unit(x)

def motor(d, f0, f1):
    n = sec(d); f = np.linspace(f0, f1, n); p = 2 * np.pi * np.cumsum(f) / SR
    e = fade(n, .05, d * .6)
    return (np.sin(p) + .4 * np.sin(2 * p) + .2 * np.sin(3 * p)) * e * .5 + bp(nz(n), 800, 3000) * .15 * e

def zoom_fx(d, f0):
    n = sec(d); t = tv(n)
    f = f0 * (1 + .05 * np.minimum(t / .12, 1)) + 22 * np.sin(2 * np.pi * 9 * t)
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = (np.sin(ph) + .45 * np.sin(2 * ph) + .1 * np.sign(np.sin(ph))) * (1 + .25 * np.sin(2 * np.pi * 38 * t))
    x = bp(x, 600, 6000) + bp(nz(n), 2500, 6000) * .2
    return unit(x * fade(n, .04, .06))

def af_fx():
    n = sec(.3); x = np.zeros(n)
    for j in range(rng.integers(4, 7)):
        m = sec(.008); i = sec(j * rng.uniform(.035, .06))
        x[i:i + m] += hp(nz(m), 3000) * dec(m, .0015) * rng.uniform(.6, 1)
    w = sec(.2); x[:w] += np.sin(2 * np.pi * 2750 * tv(w)) * np.sin(np.pi * np.linspace(0, 1, w)) * .08
    return x

def thunk():
    """every relay in the wing closing at once: deep body + heavy knock + clank + the ballasts' inrush whump,
    driven into the camcorder mic until it saturates (dense, low crest: loud without a needle peak)"""
    n = sec(1.4); t = tv(n)
    f = 40 + 30 * np.exp(-t / .06)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * dec(n, .22)
    body = np.sin(2 * np.pi * 105 * t * (1 - .15 * t)) * dec(n, .16)
    knock = lp(nz(n), 420) * dec(n, .05)
    clank = bp(nz(n), 180, 1400) * dec(n, .035) + sum(a * np.sin(2 * np.pi * fr * t + rng.random() * 6) * dec(n, tau)
                                                    for fr, a, tau in [(310, .5, .09), (523, .35, .07), (871, .25, .05), (1460, .15, .03)])
    trans = hp(nz(n), 2000) * dec(n, .002)
    whump = (np.sin(2 * np.pi * 120 * t) + .6 * np.sin(2 * np.pi * 240 * t + 1)) * np.minimum(1, t / .03) * dec(n, .35) * .45
    x = sub * .6 + body * .6 + unit(knock) * .7 + unit(clank) * .55 + trans * .25 + whump
    x = np.tanh(2.6 * unit(x)) / np.tanh(2.6)
    return x * fade(n, 0, .3)

def breath(t0, d_in, d_out, g, shaky=0., gap=.07):
    n1 = sec(d_in); a = nz(n1)
    inh = rmsn(bp(a, 800, 3400) + bp(a, 1700, 2600) * .8) * np.sin(np.linspace(0, np.pi, n1)) ** 1.4
    n2 = sec(d_out); u = np.linspace(0, 1, n2); b = nz(n2)
    exh = rmsn(bp(b, 300, 1600) + bp(b, 900, 1300) * .5) * np.minimum(1, u / .12) * (1 - u) ** 1.6
    if shaky:
        inh *= np.maximum(0, 1 + shaky * .6 * wander(n1, .03))
        exh *= np.maximum(0, 1 + shaky * .6 * wander(n2, .03))
    put('dry', inh, t0, g * .8); put('n', inh, t0, g * .08)
    put('dry', exh, t0 + d_in + gap, g); put('n', exh, t0 + d_in + gap, g * .08)

def gasp():
    n = sec(.42); u = tv(n); a = nz(n)
    env = np.minimum(1, u / .025) * (1 - .3 * u / .36) * (u < .36)
    env = uniform_filter1d(env, sec(.004))
    x = rmsn(bp(a, 700, 4800) + bp(a, 1800, 2600) * .7) * env
    pulse = (np.sin(2 * np.pi * 230 * u * (1 + .1 * u)) > .97).astype(float)       # a little voicing at the top
    x += rmsn(bp(pulse, 500, 2000)) * np.minimum(1, u / .02) * dec(n, .12) * .35
    i = sec(.36); m = sec(.01); x[i:i + m] += hp(nz(m), 1500) * dec(m, .002) * 1.5   # glottis closes
    return x

def long_exhale():
    n = sec(2.6); u = np.linspace(0, 1, n); a = nz(n)
    trem = 1 + .35 * np.sin(2 * np.pi * 5.5 * tv(n) + 1.2 * np.sin(2 * np.pi * .7 * tv(n))) * np.minimum(1, u * 3)
    env = np.minimum(1, u / .06) * (1 - u) ** 1.2 * trem
    bright = rmsn(bp(a, 600, 2200)); dark = rmsn(bp(a, 250, 1100))
    return (bright * (1 - u) + dark * u) * env

def catch():
    n = sec(.085); u = np.linspace(0, 1, n)
    x = rmsn(bp(nz(n), 900, 3600)) * u ** 1.5
    m = sec(.008); x[-m:] += hp(nz(m), 1500) * dec(m, .0015) * 1.2
    return x

# ═══════════════════════════════ 1. FLUORESCENT HUM BED ═══════════════════════════════
t1 = time.time()
D = np.hypot(FZ[None, :] - CZ[:, None], H_MIC)               # rows × panels: distance to each panel
AN = (H_MIC / D) ** HUM_NEAR_POW
AF = (H_MIC / D) ** HUM_FAR_POW
def up(e): return uniform_filter1d(np.interp(tt, RT, e), sec(HUM_SMOOTH))
wob = 1 + .0012 * np.sin(2 * np.pi * .07 * tt) + .0006 * np.sin(2 * np.pi * .31 * tt + 1)   # mains drift
PH = 2 * np.pi * 120 * np.cumsum(wob) / SR
near = np.zeros(N); hum_mix = np.zeros(N); buzz_mix = np.zeros(N); en_all2 = np.zeros(N)
bad = np.zeros(N)                                              # bad-tube buzz swells
for _ in range(6):
    t0 = rng.uniform(4, 52); d = rng.uniform(.5, 1.4); n = sec(d); a = sec(t0)
    gate = np.repeat(rng.random(n // 960 + 1) > .4, 960)[:n].astype(float)
    bad[a:a + n] += uniform_filter1d(gate, 96) * np.sin(np.linspace(0, np.pi, n)) ** 2
for g in range(3):
    en = up(np.sqrt(((LV[:, g::3] * AN[:, g::3]) ** 2).sum(1)))
    en_all2 += en ** 2
    hum = rmsn(sum(a * np.sin((h + 1) * PH + 1.3 * h + g) for h, a in enumerate(HUM_HARM[g])))
    pu = np.abs(np.sin(PH / 2 + .2 * g)) ** (8 + 4 * g)
    buzz = rmsn(bp(pu - pu.mean(), *HUM_BUZZ_BAND[g]))
    fizz = rmsn(bp(nz(N) * pu, 2500, 7000))
    bz = HUM_BUZZ[g] * (1 + (HUM_BADTUBE * 3 * bad if g == 2 else 0))
    near += (hum + buzz * bz + fizz * HUM_FIZZ) * en
    hum_mix += hum; buzz_mix += buzz
whine = np.sin(2 * np.pi * 9150 * tt + .4 * np.sin(2 * np.pi * .23 * tt)) * np.sqrt(2) * HUM_WHINE
near += whine * np.sqrt(en_all2)
far_c = rmsn(lp(hum_mix, 520, 2) + lp(buzz_mix, 1300, 2) * .35)
far_r = rotate(far_c, 75) * (1 + .12 * wander(N, 1.5))                     # right channel: phase-turned, own drift
far_c *= 1 + .12 * wander(N, 1.5)                                          # slow standing-wave drift
EF = up(np.sqrt(((LV * AF) ** 2).sum(1)))
ER = up(LROOMS)
rooms_c = rmsn(lp(hum_mix + buzz_mix * .5, 650, 2))
BED_NEAR = np.stack([near, near], 1) * HUM_NEAR_G                          # overhead: centred
BED_FAR = np.stack([far_c * EF, far_r * EF], 1) * HUM_FAR_G                  # corridor wash: wide, mono-safe
BED_ROOMS = np.stack([rooms_c * ER, rotate(rooms_c, 90) * ER], 1) * HUM_ROOMS_G
del near, hum_mix, buzz_mix, far_c, far_r, rooms_c, bad
print('hum bed %.1f s' % (time.time() - t1))

# ═══════════════════════════════ 2. ROOM TONE ═══════════════════════════════
def brown_n(n):
    w = np.cumsum(nz(n)); return rmsn(hp(w - w.mean(), 22, 2))
rec_gate = np.clip((tt - TREC - .05) / .12, 0, 1) * np.clip(1 - (tt - TOFF - .06) / .03, 0, 1)
swell = 1 + .2 * np.sin(2 * np.pi * .043 * tt + .5) + .1 * np.sin(2 * np.pi * .17 * tt)
ROOMT = np.zeros((N, 2))
for c in range(2):
    air = rmsn(lp(brown_n(N), 260, 2)) * ROOM_AIR * swell
    gri = rmsn(bp(nz(N), 250, 1400)) * ROOM_GRILLE * swell
    cam = rmsn(bp(nz(N), 700, 2600)) * (1 + .5 * np.sin(2 * np.pi * 30 * tt)) * ROOM_CAM
    ROOMT[:, c] = (air + gri + cam) * rec_gate
    hiss = rmsn(hp(nz(N), 4000, 2)) * ROOM_HISS
    hg = np.clip(tt / .03, 0, 1) * np.where(tt < TOFF + .06, 1., ROOM_BLANK) * np.clip((DUR - tt) / .3, 0, 1)
    ROOMT[:, c] += hiss * hg

# ═══════════════════════════════ 3. DRONE ═══════════════════════════════
DRONE_T0 = ANCHORS['approach'] + DRONE_LEAD
de = np.clip((tt - DRONE_T0) / (H0 - DRONE_T0), 0, 1) ** DRONE_SHAPE * (tt < H0)
DRN = np.zeros((N, 2))
for c in range(2):
    br = rmsn(bp(brown_n(N), 35, 140))
    s = np.sin(2 * np.pi * DRONE_F[0] * tt + c) + .8 * np.sin(2 * np.pi * DRONE_F[1] * tt + 2 * c)
    DRN[:, c] = np.tanh(1.4 * (br * .5 + s * .45)) * de * DRONE_G * 1.6

# ═══════════════════════════════ masks for the beds ═══════════════════════════════
M_PRE = np.ones(N); f = sec(HUSH_FADE); M_PRE[I0 - f:I0] = np.linspace(1, 0, f); M_PRE[I0:] = 0
M_POST = np.clip((tt - H1 - BED_RETURN[0]) / BED_RETURN[1], 0, 1)
BEDS = BED_NEAR + BED_FAR + BED_ROOMS + ROOMT + DRN
for key, m in [('pre', M_PRE), ('post', M_POST)]:
    BUS[key]['dry'] += BEDS * m[:, None]
    BUS[key]['n'] += BED_NEAR * (HUM_NEAR_SEND * m)[:, None]
    BUS[key]['f'] += (BED_FAR * HUM_FAR_SEND + BED_ROOMS * HUM_ROOMS_SEND) * m[:, None]
BED_ONLY = BEDS.copy()                                           # kept for the checks
del BEDS, ROOMT, DRN

# ═══════════════════════════════ 4. FOLEY ═══════════════════════════════
t1 = time.time()
first_all = ANCHORS['restrike']
zooms = [e['t'] for e in ev('zoom')]
for e in EV:
    ty, t = e['type'], e['t']
    if ty == 'strike':
        k, d = e['k'], dist(e['z'], t)
        if e['all']:
            pan, g, on, sp = (.45 if d > 4 else .15) * (2 * float(jhash(k * 7.1)) - 1), FX_STRIKE * FX_STRIKE_ALL, *strike_fx(k, FX_RELAY_ALL)
        else:
            pan, g, on, sp = .12 * (2 * float(jhash(k * 3.3)) - 1), FX_STRIKE, *strike_fx(k)
        place(on, t, d, g, pan, tag='strike'); place(sp, t, d, g, pan, wet=FX_SPUTTER_WET)
    elif ty == 'off':
        k, d = e['k'], dist(e['z'], t)
        behind = e['z'] > cam_z(t) + .5                       # the camera faces -z: relays behind it alternate left / right
        pan = .3 * (-1) ** k if behind else .12 * (2 * float(jhash(k * 3.3)) - 1)
        place(off_fx(), t, d, FX_OFF, pan, tag='off')
    elif ty == 'led':
        place(led_tick(), t, dist(e['z'], t), FX_LED, 0., slope=FX_LED_SLOPE, wet=.5, tag='led')
    elif ty == 'step':
        place(step_fx(e['v']), t, 1.6, FX_STEP, .06 * (-1) ** len(LOG), wet=.8, tag='step')
    elif ty == 'rustle':
        place(rustle_fx(e['v']), t, .9, FX_RUSTLE, rng.uniform(-.25, .25), wet=.3, tag='rustle')
    elif ty == 'crouch':
        place(crouch_fx(), t, 1.0, FX_CROUCH, .05, wet=.4, tag='crouch')
    elif ty == 'zoom':
        put('dry', zoom_fx(e['d'], 1180 if zooms.index(t) % 2 == 0 else 1270), t, FX_ZOOM, .1)   # in, then out
        LOG.append(('zoom', t, FX_ZOOM, 0))
    elif ty == 'af':
        put('dry', af_fx(), t, FX_AF, .1); LOG.append(('af', t, FX_AF, 0))
    elif ty in ('recOn', 'recOff'):
        on = ty == 'recOn'
        put('dry', clack(), t, FX_REC, .08); put('n', clack(), t, FX_REC * .1)
        put('dry', motor(.9 if on else .7, 90 if on else 230, 230 if on else 60), t + .04, FX_MOTOR, .05)
        LOG.append((ty, t, FX_REC, 0))
    elif ty in ('roomsOn', 'roomsOff'):
        on = ty == 'roomsOn'; cz = cam_z(t)
        for j in range(FX_ROOMS_N):
            side = 1 if j % 2 else -1; zr = rng.uniform(-62, 0)
            d = float(np.hypot(zr - cz, 3.6)); tj = t + rng.uniform(0, .05)
            x = sum(strike_fx(99, 1.)) if on else off_fx()
            place(x, tj, d, FX_ROOMS, side * rng.uniform(.45, .95), wet=1.3, muffle=900)
        LOG.append((ty, t, FX_ROOMS, 0))
    elif ty == 'holdBreath':
        put('dry', catch(), t, BR_G * BR_CATCH)
    elif ty == 'gasp':
        x = gasp(); put('dry', x, t, BR_G * BR_GASP); put('n', x, t, BR_G * BR_GASP * .15)
    elif ty == 'exhale':
        x = long_exhale(); put('dry', x, t, BR_G * BR_EXHALE); put('n', x, t, BR_G * BR_EXHALE * .1)
# the restrike: one heavy thunk under all the ballasts
x = thunk()
put('dry', x, first_all, FX_THUNK); xs = hp(x, 90, 2)
put('n', xs, first_all, FX_THUNK * FX_THUNK_SENDS[0]); put('f', lp(xs, 2500), first_all, FX_THUNK * FX_THUNK_SENDS[1])
LOG.append(('thunk', first_all, FX_THUNK, 0))

# ═══════════════════════════════ 5. BREATHING ═══════════════════════════════
STOPS = [(at(a), at(b)) for a, b in BR_STOP]
def stop_after(t):   # start of the next stop zone after t
    return min([a for a, b in STOPS if a > t] + [99])
def in_stop(t): return any(a <= t < b for a, b in STOPS)
for a0, a, b, g, sh in BR_EXTRA:
    breath(at(a0), a, b, BR_G * g, sh); LOG.append(('breath', at(a0), BR_G * g, 0))
t = BR_ANCH[0, 0]
while t < DUR:
    if in_stop(t): t = [b for a, b in STOPS if a <= t < b][0]; continue
    per, g, sh = (np.interp(t, BR_ANCH[:, 0], BR_ANCH[:, j]) for j in (1, 2, 3))
    d_in, d_out = per * .36 * rng.uniform(.9, 1.1), per * .44 * rng.uniform(.9, 1.1)
    if t + d_in + d_out + .1 > stop_after(t): t = stop_after(t); continue
    breath(t, d_in, d_out, BR_G * g, sh)
    LOG.append(('breath', t, BR_G * g, 0))
    t += per * rng.uniform(.93, 1.07)
print('foley + breath %.1f s' % (time.time() - t1))

# ═══════════════════════════════ REVERB + ASSEMBLY ═══════════════════════════════
t1 = time.time()
def make_ir(rt, dur, pre, att, flutter, dark):
    """corridor IR: band-wise exponential decays (highs die first), early reflections,
    a flutter echo between the walls (3 m apart → 17.5 ms), unit energy per channel"""
    n = sec(dur); t = tv(n); out = np.zeros((n, 2))
    bands = [(None, 250, 1.15), (250, 1500, 1.0), (1500, 5000, .72 * dark ** .3), (5000, None, .4 * dark ** .5)]
    for c in range(2):
        x = np.zeros(n)
        for lo, hi, m in bands:
            w = nz(n); w = lp(w, hi) if lo is None else hp(w, lo) if hi is None else bp(w, lo, hi)
            x += w * np.exp(-6.91 * t / (rt * m))
        x *= np.clip((t - pre) / att, 0, 1) ** 1.5
        ex = (x ** 2).sum()
        er = np.zeros(n)                                          # early reflections (floor, ceiling, lockers)
        for j in range(14):
            i = sec(pre + rng.uniform(.002, .055)); er[i] += rng.choice([-1, 1]) * rng.uniform(.4, 1) * (1 - j / 16)
        er = lp(er, 6000)
        x += er * np.sqrt(.15 * ex / (er ** 2).sum())
        imp = np.zeros(n)
        for j in range(1, 24):                                    # flutter echo
            i = sec(pre + j * .0175 * (1 + .004 * rng.standard_normal())); imp[i] += (-1) ** j * np.exp(-j * .0175 / .11)
        fl = bp(imp, 900, 5000)
        x += fl * flutter * np.sqrt(ex / (fl ** 2).sum())
        if dark < 1: x = lp(x, 2200 + 5000 * dark, 2)
        out[:, c] = x / np.sqrt((x ** 2).sum())
    return out
IRN, IRF = make_ir(**VERB_NEAR), make_ir(**VERB_FAR)
def conv(x, ir):
    return np.stack([oaconvolve(x[:, c], ir[:, c])[:N] for c in range(2)], 1)
def eq(x):
    return np.stack([lp(hp(x[:, c], MASTER_HP, 2), MASTER_LP, 2) for c in range(2)], 1)
PART = {}
for key in ('pre', 'post'):
    b = BUS[key]
    PART[key] = eq(b['dry'] + conv(b['n'], IRN) + conv(b['f'], IRF))
PART['pre'] *= M_PRE[:, None]                                    # the hush: everything before it stops dead
mix = (PART['pre'] + PART['post']) * MASTER_G
print('reverb + assembly %.1f s' % (time.time() - t1))

# ═══════════════════════════════ 6. RIDE + SOFT CLIP + SAFETY LIMITER + HUSH ═══════════════════════════════
t1 = time.time()
def kweight(x):
    """ITU-R BS.1770 K-weighting at 48 kHz (high shelf + RLB high-pass), along axis 0"""
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
def true_peak(x):
    return max(np.abs(resample_poly(x[:, c], 4, 1)).max() for c in range(2))
def limit(x, ceil):
    """linked look-ahead peak limiter: 5 ms look-ahead, 30 ms hold, 10 ms smoothing (never exceeds ceil)"""
    pk = np.abs(x).max(1); n5 = sec(.005)
    g = np.minimum(1, ceil / np.maximum(maximum_filter1d(pk, 2 * n5 + 1), 1e-12))
    g = uniform_filter1d(minimum_filter1d(g, sec(.03)), sec(.01))
    return x * g[:, None], g
RAW = loudness(mix); RAW_PK = np.abs(mix).max()
RIDE_T = sorted(((ANCHORS[a] + o, g) for a, o, g in RIDE), key=lambda p: p[0])
rt_, rg_ = np.array(RIDE_T).T
def ride_at(t): return float(np.interp(t, rt_, rg_))
mix *= 10 ** (np.interp(tt, rt_, rg_) / 20)[:, None]
I_ride, _ = loudness(mix)
def softclip(x, c, knee_db):
    """identity below c·10^(-knee/20), then bends smoothly (slope-continuous) towards c, never past it"""
    a = c * 10 ** (-knee_db / 20); ax = np.abs(x); o = ax > a; y = x.copy()
    y[o] = np.sign(x[o]) * (a + (c - a) * np.tanh((ax[o] - a) / (c - a))); return y
ceil = min(10 ** (CEIL_DB / 20), 10 ** ((I_ride + PLR_MAX) / 20))
PRE = mix
for it in range(4):                       # pull the ceiling down until true peak − loudness ≤ PLR_TP on the finished signal
    SOFT_N = int((np.abs(PRE) > ceil * .985 * 10 ** (-SOFT_KNEE / 20)).sum())
    mix, LIM = limit(softclip(PRE, ceil * .985, SOFT_KNEE), ceil)
    ex = 20 * np.log10(true_peak(mix)) - loudness(mix)[0] - PLR_TP
    if ex <= 0: break
    ceil *= 10 ** (-(ex + .1) / 20)
del PRE
mix[-sec(END_FADE):] *= np.linspace(1, 0, sec(END_FADE))[:, None]
mix[I0:I1] = 0.0                                                  # digital silence, exactly
mix = mix[:N].astype(np.float32)
sf.write(os.path.join(OUT, 'mix.wav'), mix, SR, subtype='FLOAT')
T_RUN = time.time() - T_START
I_out, LRA_out = loudness(mix.astype(float)); TP_out = 20 * np.log10(true_peak(mix.astype(float)))
print('ride + limiter + meters %.1f s' % (time.time() - t1))

# ═══════════════════════════════ CHECKS ═══════════════════════════════
def db(x): return 20 * np.log10(np.sqrt(np.mean(np.asarray(x, float) ** 2)) + 1e-12)
def pdb(x): return 20 * np.log10(np.abs(x).max() + 1e-12)
print('L/R correlation %.2f · mono-sum RMS vs stereo %.1f dB' % (np.corrcoef(mix[:, 0], mix[:, 1])[0, 1], db(mix.astype(float).mean(1)) - db(mix)))
print('\nwrote out/mix.wav  %d samples = %.4f s (dur %.4f), %d Hz stereo float' % (len(mix), len(mix) / SR, DUR, SR))
print('raw mix: I %.1f LUFS, LRA %.1f LU, peak %.1f dBFS' % (RAW[0], RAW[1], pdb(RAW_PK)))
print('ceiling %.1f dBFS · soft clip touched %d samples (%.3f %%) · safety limiter max reduction %.1f dB'
      % (20 * np.log10(ceil), SOFT_N, 100 * SOFT_N / (2 * N), -20 * np.log10(LIM.min())))
print('OUT: I %.1f LUFS · LRA %.1f LU · true peak %.1f dBTP · TP − I = %.1f dB  → mux loudnorm %s'
      % (I_out, LRA_out, TP_out, TP_out - I_out, 'can stay LINEAR' if LRA_out <= 10.0 and TP_out - I_out <= PLR_TP + .05 else
         'may go DYNAMIC (ffmpeg reads LRA ~1 LU higher than this meter; it needs ≤ 11)'))
hz = mix[I0:I1]
print('HUSH %.3f–%.3f s: max|x| = %r over %d samples  → %s' % (H0, H1, float(np.abs(hz).max()), len(hz),
                                                             'EXACT ZERO' if np.abs(hz).max() == 0 else 'NOT ZERO'))
print('peak overall %.2f dBFS (%s)' % (pdb(mix), 'ok ≤ -1' if pdb(mix) <= -1 else 'TOO HOT'))
print('\nsection        RMS dBFS  peak dBFS')
for a, b in [(0, 3), (3, 12), (13, 23), (23, 28.4), (27.0, 28.4), (27.2, 28.35), (28.4, 39.4), (40.8, 43.3), (43.4, 45), (45, 52), (52, 59), (59, 60.7)]:
    s = mix[sec(a):sec(b)]
    print('  %5.1f–%-5.1f  %7.1f  %8.1f' % (a, b, db(s), pdb(s)))
# 0.5 s loudest window
w = sec(.5); e2 = uniform_filter1d((mix.astype(float) ** 2).mean(1), w)
i = int(np.argmax(e2)); print('loudest 0.5 s window centred at %.2f s (%.1f dBFS RMS)' % (i / SR, 10 * np.log10(e2[i] + 1e-20)))
e2[sec(first_all - .4):sec(first_all + 2.6)] = 0; j = int(np.argmax(e2))
print('loudest 0.5 s window outside the restrike (%.1f–%.1f s): %.2f s (%.1f dBFS RMS)'
      % (first_all - .4, first_all + 2.6, j / SR, 10 * np.log10(e2[j] + 1e-20)))
# every strike / off / step / led produced energy at its time
MONO = mix.astype(float).mean(1); HF = [hp(MONO, 150, 2), hp(MONO, 1000, 2), hp(MONO, 2500, 2)]
def rise(t, f=None):
    """onset check, best of: peak of the high-passed mix (150 Hz / 1 kHz / 2.5 kHz) in [t-2, t+40 ms] over its
    peak in [t-120, t-10 ms]; RMS (> 150 Hz) of [t, t+30 ms] over [t-100, t-5 ms]. dB"""
    r = []
    for x in HF:
        a = np.abs(x[max(0, sec(t - .002)):sec(t + .04)]).max(); b = np.abs(x[max(0, sec(t - .12)):sec(t - .01)]).max()
        r.append(20 * np.log10((a + 1e-12) / (b + 1e-12)))
    r.append(db(HF[0][sec(t):sec(t + .03)]) - db(HF[0][max(0, sec(t - .1)):sec(t - .005)]))
    return max(r)
print('\nevents: own dry contribution peak (dBFS, incl. the ride) and onset in the mix (dB, see rise())')
cnt = {}
for ty, t, p, d in LOG:
    if ty not in ('strike', 'off', 'step', 'led'): continue
    c = cnt.setdefault(ty, [0, 0, 0]); c[0] += 1; c[1] += p * MASTER_G > 10 ** (-100 / 20)
    c[2] += rise(t) > 3
for ty, (a, b, c) in cnt.items():
    print('  %-6s %3d events, %3d with energy > -100 dBFS, %3d with an onset > 3 dB in the mix' % (ty, a, b, c))
def pick(ty, idx, cond=lambda e: True):
    L = [e['t'] for e in EV if e['type'] == ty and cond(e)]; return sorted({L[i] for i in idx if -len(L) <= i < len(L)})
SPOT = {'strike': pick('strike', [0, 1, 4, 7, 10, 14, 19], lambda e: not e['all']) + pick('strike', [0, -1], lambda e: e['all']),
        'off': pick('off', [0, 2, 3, 4, 5, 6, 7, 9, 13, 20, 26, 33]),
        'step': pick('step', [0, 2, 8, 17, 18, 19, 20]),
        'led': pick('led', [0, 5, 6, 18, -4, -3, -2, -1])}
for ty, ts in SPOT.items():
    for ts_ in ts:
        for ty2, t, p, d in LOG:
            if ty2 == ty and abs(t - ts_) < .002:
                print('  %-6s t=%7.3f  d=%5.1f m  own peak %6.1f dBFS  onset %+6.1f dB' % (ty, t, d, pdb(p * MASTER_G * 10 ** (ride_at(t) / 20)), rise(t)))
                break
print('\nmix.py ran in %.1f s' % T_RUN)
