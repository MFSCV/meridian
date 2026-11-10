use std::sync::Mutex;

const HOURS: usize = 144 * 24;
const HOUR_MS: i64 = 3_600_000;
const BAR_MS: i64 = 300_000;
const PARTS: usize = 12;

#[derive(Clone, Copy)]
struct Bar {
    time: i64,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    volume: u64,
}

struct Random(u32);

impl Random {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        f64::from(self.0) / 4_294_967_296.0
    }
}

fn hourly(seed: u32, base: f64, end: i64) -> impl Iterator<Item = Bar> {
    let mut random = Random(seed);
    let mut close = base;
    (0..HOURS).map(move |index| {
        let open = close;
        close *= 1.0 + (random.next() - 0.489) * 0.012 + (index as f64 / 80.0).sin() * 0.0008;
        let high = open.max(close) * (1.0 + random.next() * 0.003);
        let low = open.min(close) * (1.0 - random.next() * 0.003);
        let volume = (1000.0 + random.next() * 100_000.0) as u64;
        Bar {
            time: end - (HOURS - index) as i64 * HOUR_MS,
            open,
            high,
            low,
            close,
            volume,
        }
    })
}

fn split(bar: Bar) -> [Bar; PARTS] {
    let mut random = Random((bar.time / BAR_MS) as u32 ^ bar.volume as u32 ^ 0x9e37_79b9);
    let span = bar.high - bar.low;
    let top = (random.next() * PARTS as f64) as usize;
    let bottom = (random.next() * PARTS as f64) as usize;
    let weights: [f64; PARTS] = std::array::from_fn(|_| 0.5 + random.next());
    let total = weights.iter().sum::<f64>();
    let mut previous = bar.open;
    let mut used = 0;
    std::array::from_fn(|index| {
        let share = (index + 1) as f64 / PARTS as f64;
        let drift = bar.open + (bar.close - bar.open) * share;
        let last = index + 1 == PARTS;
        let close = if last {
            bar.close
        } else {
            (drift + (random.next() - 0.5) * span * 0.6 * (std::f64::consts::PI * share).sin())
                .clamp(bar.low, bar.high)
        };
        let upper = previous.max(close);
        let lower = previous.min(close);
        let volume = if last {
            bar.volume - used
        } else {
            ((bar.volume as f64 * weights[index] / total) as u64).max(1)
        };
        used += volume;
        let next = Bar {
            time: bar.time + index as i64 * BAR_MS,
            open: previous,
            high: if index == top {
                bar.high
            } else {
                upper + random.next() * 0.3 * (bar.high - upper)
            },
            low: if index == bottom {
                bar.low
            } else {
                lower - random.next() * 0.3 * (lower - bar.low)
            },
            close,
            volume,
        };
        previous = close;
        next
    })
}

fn write_series(bars: impl Iterator<Item = Bar>, interval: usize, output: &mut Vec<f64>) {
    let mut current: Option<Bar> = None;
    let mut emit = |bar: Bar| {
        output.extend([
            bar.time as f64,
            bar.open,
            bar.high,
            bar.low,
            bar.close,
            bar.volume as f64,
        ]);
    };
    for (index, bar) in bars.enumerate() {
        if index % interval == 0 {
            if let Some(previous) = current.replace(bar) {
                emit(previous);
            }
        } else if let Some(current) = &mut current {
            current.high = current.high.max(bar.high);
            current.low = current.low.min(bar.low);
            current.close = bar.close;
            current.volume += bar.volume;
        }
    }
    if let Some(last) = current {
        emit(last);
    }
}

// One synchronous instance per JavaScript realm. The host copies the output
// before making another call, which can invalidate the buffer pointer.
static OUTPUT: Mutex<Vec<f64>> = Mutex::new(Vec::new());

#[no_mangle]
pub extern "C" fn generate(seed: u32, base: f64, minutes: u32, end: f64) -> usize {
    let mut output = OUTPUT.lock().expect("market output lock");
    output.clear();
    let bars = hourly(seed, base, end as i64);
    match minutes {
        5 | 15 | 30 => write_series(bars.flat_map(split), minutes as usize / 5, &mut output),
        60 | 120 | 240 | 720 | 1440 | 10080 => {
            write_series(bars, minutes as usize / 60, &mut output)
        }
        _ => {}
    }
    output.len()
}

#[no_mangle]
pub extern "C" fn result_ptr() -> *const f64 {
    OUTPUT.lock().expect("market output lock").as_ptr()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_preserves_hourly_ohlcv() {
        for bar in hourly(7, 575.0, 1_794_268_800_000) {
            let mut output = Vec::new();
            write_series(split(bar).into_iter(), PARTS, &mut output);
            assert_eq!(
                output,
                [
                    bar.time as f64,
                    bar.open,
                    bar.high,
                    bar.low,
                    bar.close,
                    bar.volume as f64
                ]
            );
        }
    }
}
