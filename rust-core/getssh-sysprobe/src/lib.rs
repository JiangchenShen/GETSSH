#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

use napi::bindgen_prelude::*;
use std::sync::Mutex;
use sysinfo::{System, Networks};

lazy_static::lazy_static! {
    static ref SYS: Mutex<System> = Mutex::new(System::new_all());
    static ref NETS: Mutex<Networks> = Mutex::new(Networks::new_with_refreshed_list());
}

#[napi(object)]
pub struct MemStats {
    pub total: i64,
    pub free: i64,
    pub used: i64,
}

#[napi(object)]
pub struct CpuStats {
    pub overall: f64,
    pub cores: Vec<f64>,
}

#[napi(object)]
pub struct NetStats {
    pub rx: i64,
    pub tx: i64,
}

#[napi(object)]
pub struct SystemStats {
    pub cpus: CpuStats,
    pub mem: MemStats,
    pub net: NetStats,
}

#[napi]
pub fn get_system_stats() -> Result<SystemStats> {
    // If a previous call panicked while the Mutex was locked, Rust marks it as
    // "poisoned" and all subsequent .lock() calls return Err. Using into_inner() recovers the
    // guard from a poisoned state so the system monitor does not permanently break.
    let mut sys = SYS.lock().unwrap_or_else(|poisoned| {
        SYS.clear_poison();
        poisoned.into_inner()
    });
    let mut nets = NETS.lock().unwrap_or_else(|poisoned| {
        NETS.clear_poison();
        poisoned.into_inner()
    });

    // Refresh only what we need
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    nets.refresh(true);

    let cpus = sys.cpus();
    let overall_usage = sys.global_cpu_usage() as f64;
    let core_usages = cpus.iter().map(|c| c.cpu_usage() as f64).collect();

    let mem_total = sys.total_memory() as i64;
    let mem_used = sys.used_memory() as i64;
    let mem_free = sys.free_memory() as i64;

    let mut total_rx = 0;
    let mut total_tx = 0;

    for (_interface_name, data) in nets.iter() {
        total_rx += data.received() as i64;
        total_tx += data.transmitted() as i64;
    }

    Ok(SystemStats {
        cpus: CpuStats {
            overall: overall_usage,
            cores: core_usages,
        },
        mem: MemStats {
            total: mem_total,
            free: mem_free,
            used: mem_used,
        },
        net: NetStats {
            rx: total_rx,
            tx: total_tx,
        },
    })
}
