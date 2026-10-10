;; Finite-volume Gaussian scattering in compressed sparse rows.
;; For each tile i: next[i] = current[i] + dt * sum_j(g_ij / area_i *
;; (current[j] - current[i])). The original edge conductances, stable substeps
;; and Float64 arithmetic are retained; summation order differs from JS pairs.
;; Fixed heap, no libraries, no fast-math or new physical approximations.
(module
 (import "env" "memory" (memory 1))
 (func (export "scatter")
  (param $count i32) (param $offsets i32) (param $neighbours i32) (param $rates i32)
  (param $source i32) (param $scratch i32) (param $steps i32) (param $dt f64)
  (result i32)
  (local $step i32) (local $i i32) (local $e i32) (local $end i32) (local $swap i32)
  (local $centre f64) (local $tendency f64)
  (block $done (loop $substeps
   (br_if $done (i32.ge_u (local.get $step) (local.get $steps)))
   (local.set $i (i32.const 0))
   (block $cellsDone (loop $cells
    (br_if $cellsDone (i32.ge_u (local.get $i) (local.get $count)))
    (local.set $centre (f64.load (i32.add (local.get $source) (i32.shl (local.get $i) (i32.const 3)))))
    (local.set $tendency (f64.const 0))
    (local.set $e (i32.load (i32.add (local.get $offsets) (i32.shl (local.get $i) (i32.const 2)))))
    (local.set $end (i32.load (i32.add (local.get $offsets) (i32.shl (i32.add (local.get $i) (i32.const 1)) (i32.const 2)))))
    (block $neighboursDone (loop $connections
     (br_if $neighboursDone (i32.ge_u (local.get $e) (local.get $end)))
     (local.set $tendency (f64.add (local.get $tendency) (f64.mul
      (f64.load (i32.add (local.get $rates) (i32.shl (local.get $e) (i32.const 3))))
      (f64.sub (f64.load (i32.add (local.get $source) (i32.shl (i32.load (i32.add (local.get $neighbours) (i32.shl (local.get $e) (i32.const 2)))) (i32.const 3)))) (local.get $centre)))))
     (local.set $e (i32.add (local.get $e) (i32.const 1))) (br $connections)))
    (f64.store (i32.add (local.get $scratch) (i32.shl (local.get $i) (i32.const 3))) (f64.add (local.get $centre) (f64.mul (local.get $dt) (local.get $tendency))))
    (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $cells)))
   (local.set $swap (local.get $source)) (local.set $source (local.get $scratch)) (local.set $scratch (local.get $swap))
   (local.set $step (i32.add (local.get $step) (i32.const 1))) (br $substeps)))
  (local.get $source)))
