/**
 * Every timed body hands its result to this sink so V8 cannot prove the work is unused and
 * eliminate it. mitata stores the value in a global it later reads, which defeats DCE without the
 * cost of printing anything.
 */
export { do_not_optimize as doNotOptimize } from 'mitata';
