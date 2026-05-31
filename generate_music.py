"""Generate royalty-free demo music tracks for the music player website.
Fixed version: proper time sequencing for all tracks."""
import wave
import struct
import math
import os
import random

OUTPUT_DIR = "audio"
SAMPLE_RATE = 44100


def sine_wave(freq, duration, amplitude=0.3):
    n = int(SAMPLE_RATE * duration)
    return [amplitude * math.sin(2 * math.pi * freq * t / SAMPLE_RATE) for t in range(n)]


def saw_wave(freq, duration, amplitude=0.15):
    n = int(SAMPLE_RATE * duration)
    period = SAMPLE_RATE / freq
    return [amplitude * (2 * (t % period) / period - 1) for t in range(n)]


def square_wave(freq, duration, amplitude=0.1):
    n = int(SAMPLE_RATE * duration)
    return [amplitude * (1 if math.sin(2 * math.pi * freq * t / SAMPLE_RATE) >= 0 else -1) for t in range(n)]


def triangle_wave(freq, duration, amplitude=0.2):
    n = int(SAMPLE_RATE * duration)
    period = SAMPLE_RATE / freq
    return [amplitude * (4 * abs(((t % period) / period) - 0.5) - 1) for t in range(n)]


def noise(duration, amplitude=0.05):
    return [random.uniform(-amplitude, amplitude) for _ in range(int(SAMPLE_RATE * duration))]


def pad_to(samples, target_len):
    """Pad or truncate to exact length."""
    if len(samples) < target_len:
        return samples + [0.0] * (target_len - len(samples))
    return samples[:target_len]


def adsr_envelope(data, attack=0.05, decay=0.1, sustain=0.7, release=0.3):
    n = len(data)
    a_s = int(attack * SAMPLE_RATE)
    d_s = int(decay * SAMPLE_RATE)
    r_s = int(release * SAMPLE_RATE)
    s_start = a_s + d_s
    s_end = n - r_s

    out = []
    for i, v in enumerate(data):
        if i < a_s:
            env = i / a_s
        elif i < s_start:
            env = 1 - (1 - sustain) * (i - a_s) / d_s
        elif i <= s_end:
            env = sustain
        else:
            remaining = n - i
            env = sustain * remaining / r_s if r_s > 0 else 0
        out.append(v * max(0, min(env, 1)))
    return out


def apply_reverb(data, delay_ms=40, decay=0.3):
    d = int(delay_ms * SAMPLE_RATE / 1000)
    out = list(data)
    for i in range(d, len(data)):
        out[i] += data[i - d] * decay
    mx = max(abs(v) for v in out) if out else 1
    if mx > 0.95:
        out = [v * 0.95 / mx for v in out]
    return out


def apply_lowpass(data, cutoff=2000):
    window = max(2, int(SAMPLE_RATE / cutoff))
    out = []
    buf = []
    for v in data:
        buf.append(v)
        if len(buf) > window:
            buf.pop(0)
        out.append(sum(buf) / len(buf))
    return out


def mix(*tracks):
    """Mix multiple audio tracks (same-length lists) into one, normalizing."""
    max_len = max(len(t) for t in tracks)
    result = [0.0] * max_len
    for t in tracks:
        for i, v in enumerate(t):
            result[i] += v
    mx = max(abs(v) for v in result) if result else 1
    if mx > 0.95:
        result = [v * 0.95 / mx for v in result]
    return result


def concat(*segments):
    """Concatenate audio segments sequentially."""
    result = []
    for seg in segments:
        result.extend(seg)
    return result


def save_wav(filename, data):
    filepath = os.path.join(OUTPUT_DIR, filename)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with wave.open(filepath, "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        for sample in data:
            wf.writeframes(struct.pack("<h", int(max(-32768, min(32767, sample * 32767)))))
    size_kb = os.path.getsize(filepath) / 1024
    duration = len(data) / SAMPLE_RATE
    print(f"  Saved: {filepath} ({size_kb:.0f} KB, {duration:.0f}s)")


# ====== Music Theory Helpers ======

NOTES = {
    "C2": 65.41, "D2": 73.42, "E2": 82.41, "F2": 87.31, "G2": 98.00, "A2": 110.00, "B2": 123.47,
    "C3": 130.81, "D3": 146.83, "E3": 164.81, "F3": 174.61, "G3": 196.00, "A3": 220.00, "B3": 246.94,
    "C4": 261.63, "D4": 293.66, "E4": 329.63, "F4": 349.23, "G4": 392.00, "A4": 440.00, "B4": 493.88,
    "C5": 523.25, "D5": 587.33, "E5": 659.25, "F5": 698.46, "G5": 783.99, "A5": 880.00, "B5": 987.77,
    "C6": 1046.50,
}

CHORDS = {
    "Am": ("A3", "C4", "E4"), "F": ("F3", "A3", "C4"), "C": ("C3", "E3", "G3"),
    "G": ("G3", "B3", "D4"), "Dm": ("D3", "F3", "A3"), "Em": ("E3", "G3", "B3"),
    "E": ("E3", "G#3", "B3"),
}


def play_chord(chord_name, duration, wave_fn=sine_wave, amp=0.12):
    """Mix all notes of a chord into one track of length `duration`."""
    tracks = []
    for note in CHORDS[chord_name]:
        freq = NOTES.get(note, 220)
        tracks.append(wave_fn(freq, duration, amp))
    return mix(*tracks)


def play_bass(note_name, duration, wave_fn=saw_wave, amp=0.12):
    """Single bass note."""
    freq = NOTES[note_name] / 2  # one octave down
    return wave_fn(freq, duration, amp)


def play_melody(note_sequence, note_duration, wave_fn=sine_wave, amp=0.2):
    """Play a sequence of notes concatenated."""
    segments = []
    for note in note_sequence:
        freq = NOTES.get(note, 440)
        seg = wave_fn(freq, note_duration, amp)
        seg = adsr_envelope(seg, attack=0.02, decay=0.1, sustain=0.6, release=0.15)
        segments.append(seg)
    return concat(*segments)


def make_kick(duration=0.15):
    """Synthesize a kick drum sound."""
    k = mix(
        sine_wave(60, duration, 0.6),
        sine_wave(45, duration, 0.4),
    )
    return adsr_envelope(k, attack=0.002, decay=0.15, sustain=0, release=0.01)


def make_snare(duration=0.1):
    """Synthesize a snare sound."""
    n = noise(duration, 0.15)
    n = apply_lowpass(n, cutoff=4000)
    return adsr_envelope(n, attack=0.001, decay=0.1, sustain=0, release=0.01)


def make_hihat(duration=0.04):
    """Synthesize a hi-hat sound."""
    n = noise(duration, 0.08)
    n = apply_lowpass(n, cutoff=8000)
    return adsr_envelope(n, attack=0.001, decay=0.04, sustain=0, release=0.01)


def drum_pattern(beat_dur, num_beats, pattern="basic"):
    """Create a drum track for `num_beats` of length `beat_dur` each.
    pattern: 'basic' = kick on 1+3, snare on 2+4; 'fourfloor' = kick every beat."""
    total = int(num_beats * beat_dur * SAMPLE_RATE)
    result = [0.0] * total

    for b in range(num_beats):
        offset = int(b * beat_dur * SAMPLE_RATE)

        if pattern == "fourfloor":
            # Kick on every beat
            k = make_kick()
            for i, v in enumerate(k):
                if offset + i < total:
                    result[offset + i] += v
            # Hihat on offbeats
            hh = make_hihat()
            off = int((b + 0.5) * beat_dur * SAMPLE_RATE)
            for i, v in enumerate(hh):
                if off + i < total:
                    result[off + i] += v * 0.6

        elif pattern == "basic":
            if b % 4 == 0:  # Kick on 1
                k = make_kick()
                for i, v in enumerate(k):
                    if offset + i < total:
                        result[offset + i] += v
            elif b % 4 == 2:  # Kick on 3 (softer)
                k = make_kick()
                for i, v in enumerate(k):
                    if offset + i < total:
                        result[offset + i] += v * 0.6
            if b % 2 == 1:  # Snare on 2 and 4
                s = make_snare()
                for i, v in enumerate(s):
                    if offset + i < total:
                        result[offset + i] += v
            # Hihat every beat
            hh = make_hihat()
            for i, v in enumerate(hh):
                if offset + i < total:
                    result[offset + i] += v * 0.3

        elif pattern == "lofi":
            if b % 4 == 0:
                k = make_kick()
                for i, v in enumerate(k):
                    if offset + i < total:
                        result[offset + i] += v * 0.7
            if b % 4 == 2:
                s = make_snare()
                for i, v in enumerate(s):
                    if offset + i < total:
                        result[offset + i] += v * 0.5
            # occasional hihat
            if b % 2 == 0:
                hh = make_hihat()
                for i, v in enumerate(hh):
                    if offset + i < total:
                        result[offset + i] += v * 0.2

    mx = max(abs(v) for v in result) if result else 1
    if mx > 0.9:
        result = [v * 0.9 / mx for v in result]
    return result


# ====== Track Generators ======

def generate_track1_chill():
    """Chill Ambient — slow evolving pads, gentle melody, ~60s."""
    print("Generating Track 1: Chill Ambient...")
    chord_prog = ["Am", "F", "C", "G"]
    section_dur = 4.0  # each chord lasts 4s
    sections = []

    for _ in range(4):  # 4 cycles = 64s
        for chord in chord_prog:
            pad = play_chord(chord, section_dur, triangle_wave, 0.18)
            pad = apply_lowpass(pad, cutoff=600)
            sections.append(pad)

    bg = concat(*sections)
    bg = apply_reverb(bg, delay_ms=80, decay=0.5)
    bg = adsr_envelope(bg, attack=2.0, decay=1.0, sustain=0.7, release=2.0)

    # Melody on top
    melody_notes = (["A4", "C5", "E5", "D5", "C5", "A4", "G4", "A4"] +
                    ["A4", "C5", "E5", "G5", "E5", "C5", "D5", "C5"]) * 4
    melody = play_melody(melody_notes, section_dur / 2, sine_wave, 0.12)
    melody = apply_reverb(melody, delay_ms=50, decay=0.3)

    min_len = min(len(bg), len(melody))
    return mix(bg[:min_len], melody[:min_len])


def generate_track2_upbeat():
    """Upbeat Energetic — driving bass, four-on-the-floor beat, ~48s."""
    print("Generating Track 2: Upbeat Energetic...")
    chord_prog = ["C", "G", "Am", "F"]
    section_dur = 2.0  # each chord: 2s (8 beats at 120bpm)
    num_cycles = 6
    sections = []
    bass_track = []
    chord_track = []

    for _ in range(num_cycles):
        for chord in chord_prog:
            # Bass
            root = CHORDS[chord][0]
            b = play_bass(root, section_dur, saw_wave, 0.15)
            b = apply_lowpass(b, cutoff=400)
            bass_track.append(b)

            # Chords
            c = play_chord(chord, section_dur, square_wave, 0.06)
            c = apply_lowpass(c, cutoff=2500)
            chord_track.append(c)

    bg = mix(concat(*bass_track), concat(*chord_track))
    bg = apply_reverb(bg, delay_ms=30, decay=0.15)

    # Drums: four-on-the-floor
    beat_dur = section_dur / 4  # 0.5s per beat
    total_beats = num_cycles * len(chord_prog) * 4
    drums = drum_pattern(beat_dur, total_beats, "fourfloor")

    result = mix(bg, pad_to(drums, len(bg)))
    return adsr_envelope(result, attack=0.1, decay=0.3, sustain=0.85, release=0.5)


def generate_track3_lofi():
    """Lo-fi Beat — warm pads, lofi drums, ~48s."""
    print("Generating Track 3: Lo-fi Beat...")
    chord_prog = ["Dm", "Em", "Am", "G"]
    section_dur = 3.0
    num_cycles = 4
    sections = []

    for _ in range(num_cycles):
        for chord in chord_prog:
            pad = play_chord(chord, section_dur, triangle_wave, 0.14)
            pad = apply_lowpass(pad, cutoff=1000)
            pad = apply_reverb(pad, delay_ms=60, decay=0.4)
            sections.append(pad)

    bg = concat(*sections)
    bg = apply_reverb(bg, delay_ms=30, decay=0.25)

    # Lofi drums
    beat_dur = section_dur / 4
    total_beats = num_cycles * len(chord_prog) * 4
    drums = drum_pattern(beat_dur, total_beats, "lofi")
    drums = apply_lowpass(drums, cutoff=3000)

    # Simple melody
    melody_notes = ["D4", "E4", "A4", "G4", "D4", "E4", "A4", "B4"] * 8
    melody = play_melody(melody_notes, section_dur / 2, triangle_wave, 0.1)
    melody = apply_lowpass(melody, cutoff=2000)
    melody = apply_reverb(melody, delay_ms=40, decay=0.4)

    min_len = min(len(bg), len(drums), len(melody))
    return mix(bg[:min_len], drums[:min_len], melody[:min_len])


def generate_track4_cinematic():
    """Cinematic — orchestral build-up, ~50s."""
    print("Generating Track 4: Cinematic...")
    chord_prog = ["Am", "F", "C", "G"]
    section_dur = 5.0
    num_cycles = 3
    sections = []

    for cycle in range(num_cycles):
        for chord in chord_prog:
            pad = play_chord(chord, section_dur, triangle_wave, 0.12)
            pad = apply_lowpass(pad, cutoff=500 + cycle * 200)
            pad = apply_reverb(pad, delay_ms=90, decay=0.5)
            # Crescendo
            pad = [v * (0.4 + cycle * 0.25) for v in pad]
            sections.append(pad)

    bg = concat(*sections)
    bg = apply_reverb(bg, delay_ms=60, decay=0.35)

    # Slow melody that builds
    melody_notes = ["A3", "C4", "E4", "F4", "E4", "C4", "G3", "C4"] * 6
    melody = play_melody(melody_notes, section_dur / 2, triangle_wave, 0.08)
    melody = apply_reverb(melody, delay_ms=70, decay=0.5)

    min_len = min(len(bg), len(melody))
    result = mix(bg[:min_len], melody[:min_len])
    return adsr_envelope(result, attack=2.0, decay=2.0, sustain=0.8, release=3.0)


def generate_track5_synthwave():
    """Synthwave — retro electronic with arpeggios, ~50s."""
    print("Generating Track 5: Synthwave...")
    chord_prog = ["Am", "F", "G", "Em"]
    section_dur = 2.5
    num_cycles = 5
    chord_segments = []
    bass_segments = []
    arp_segments = []

    for _ in range(num_cycles):
        for chord in chord_prog:
            # Pad
            pad = play_chord(chord, section_dur, saw_wave, 0.1)
            pad = apply_lowpass(pad, cutoff=1800)
            pad = apply_reverb(pad, delay_ms=30, decay=0.2)
            chord_segments.append(pad)

            # Bass
            root = CHORDS[chord][0]
            b = play_bass(root, section_dur, saw_wave, 0.12)
            b = apply_lowpass(b, cutoff=300)
            bass_segments.append(b)

            # Arpeggio
            arp_notes = []
            note_names = [
                root.replace("3", "4") if "3" in root else root,
                root.replace("3", "4") if "3" in root else (root[0] + str(int(root[1]) + 1)),
            ]
            for i in range(8):
                step = [1, 1.5, 2, 3, 2, 1.5, 1, 3][i % 8]
                freq = NOTES.get(root, 220) * step
                arp_notes.append(freq)
            arp_data = []
            note_len = section_dur / 8
            for freq in arp_notes:
                s = saw_wave(freq, note_len, 0.06)
                s = adsr_envelope(s, attack=0.005, decay=0.08, sustain=0.4, release=0.05)
                arp_data.extend(s)
            arp_segments.append(arp_data)

    bg = mix(
        concat(*chord_segments),
        concat(*bass_segments),
        concat(*arp_segments),
    )

    # Four-on-the-floor drums
    beat_dur = section_dur / 4
    total_beats = num_cycles * len(chord_prog) * 4
    drums = drum_pattern(beat_dur, total_beats, "fourfloor")

    result = mix(bg, pad_to(drums, len(bg)))
    return adsr_envelope(result, attack=0.2, decay=0.5, sustain=0.8, release=0.5)


def main():
    print("=" * 50)
    print("Generating 5 royalty-free demo music tracks...")
    print("All tracks are CC0 — use freely!")
    print("=" * 50)

    tracks = [
        ("chill-ambient.wav", generate_track1_chill),
        ("upbeat-energetic.wav", generate_track2_upbeat),
        ("lofi-beat.wav", generate_track3_lofi),
        ("cinematic.wav", generate_track4_cinematic),
        ("synthwave.wav", generate_track5_synthwave),
    ]

    for filename, gen_fn in tracks:
        data = gen_fn()
        save_wav(filename, data)

    print("=" * 50)
    print(f"Done! Files in: {os.path.abspath(OUTPUT_DIR)}")
    print("=" * 50)


if __name__ == "__main__":
    main()
