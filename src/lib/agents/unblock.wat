(module
  ;; Unblock Agent
  ;; Flags blocker tasks as urgent when they're holding up 2+ other incomplete tasks.
  ;; Uses host_get_dependency_data (binary format) and host_emit_urgency (host builds JSON).

  ;; --- Host imports ---
  (import "env" "memory" (memory 1))
  (import "env" "host_get_dependency_data" (func $get_dep_data (param i32 i32) (result i32)))
  (import "env" "host_emit_urgency" (func $emit_urgency (param i32 i32)))
  (import "env" "host_log" (func $host_log (param i32 i32)))
  (import "env" "host_get_now" (func $get_now (result i32)))
  (import "env" "host_get_state" (func $get_state (param i32 i32) (result i32)))
  (import "env" "host_set_state" (func $set_state (param i32 i32)))
  (import "env" "host_get_event" (func $get_event (param i32 i32) (result i32)))
  (import "env" "host_get_tasks" (func $get_tasks (param i32 i32) (result i32)))
  (import "env" "host_get_members" (func $get_members (param i32 i32) (result i32)))
  (import "env" "host_emit_event" (func $emit_event (param i32 i32)))

  ;; --- Constants ---
  ;; Binary format (must match runtime.ts DEP_TASK_ID_SIZE, DEP_TASK_RECORD_SIZE):
  ;; Task record: 36 bytes taskId + 1 byte status + 1 byte isUrgent + 1 byte dependentCount = 39 bytes
  ;; Header: 4 bytes taskCount

  ;; Memory layout:
  ;;   0x0000 - 0x3FFF : dependency data buffer (16KB — up to ~419 tasks)
  ;;   0x4000 - 0x4003 : last-run timestamp (4 bytes, persisted state)

  ;; --- Exports ---
  (export "init" (func $init))
  (export "on_task_event" (func $on_task_event))
  (export "on_tick" (func $on_tick))

  ;; --- init: load persisted state ---
  (func $init
    (drop (call $get_state (i32.const 0x4000) (i32.const 4)))
  )

  ;; --- on_task_event: no-op (we only act on tick) ---
  (func $on_task_event)

  ;; --- on_tick: main bottleneck detection logic ---
  (func $on_tick
    (local $data_len i32)
    (local $task_count i32)
    (local $i i32)
    (local $record_ptr i32)
    (local $status i32)
    (local $is_urgent i32)
    (local $dep_count i32)
    (local $task_id_ptr i32)
    (local $task_id_len i32)

    ;; Fetch dependency data into buffer at 0x0000
    (local.set $data_len (call $get_dep_data (i32.const 0) (i32.const 0x4000)))

    ;; Early exit if no data
    (if (i32.eqz (local.get $data_len)) (then (return)))

    ;; Parse header
    (local.set $task_count (i32.load (i32.const 0)))

    ;; Early exit if no tasks
    (if (i32.eqz (local.get $task_count)) (then (return)))

    ;; Loop through each task record (start at offset 4, stride 39)
    (local.set $i (i32.const 0))
    (local.set $record_ptr (i32.const 4))

    (block $done
      (loop $loop
        ;; Exit when all tasks processed
        (br_if $done (i32.ge_u (local.get $i) (local.get $task_count)))

        ;; Read fields at record_ptr + 36 (status), +37 (isUrgent), +38 (dependentCount)
        (local.set $status
          (i32.load8_u (i32.add (local.get $record_ptr) (i32.const 36)))
        )
        (local.set $is_urgent
          (i32.load8_u (i32.add (local.get $record_ptr) (i32.const 37)))
        )
        (local.set $dep_count
          (i32.load8_u (i32.add (local.get $record_ptr) (i32.const 38)))
        )

        ;; Flag as urgent if: status != completed(2) AND !isUrgent AND dependentCount >= 2
        (if
          (i32.and
            (i32.and
              (i32.ne (local.get $status) (i32.const 2))
              (i32.eqz (local.get $is_urgent))
            )
            (i32.ge_u (local.get $dep_count) (i32.const 2))
          )
          (then
            ;; Compute actual taskId length (strip zero-padding)
            (local.set $task_id_ptr (local.get $record_ptr))
            (local.set $task_id_len (call $strlen (local.get $task_id_ptr) (i32.const 36)))

            ;; Emit urgency flag
            (call $emit_urgency (local.get $task_id_ptr) (local.get $task_id_len))
          )
        )

        ;; Advance to next record (39 bytes per record)
        (local.set $record_ptr
          (i32.add (local.get $record_ptr) (i32.const 39))
        )
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )

    ;; Save last-run timestamp to persistent state
    (i32.store (i32.const 0x4000) (call $get_now))
    (call $set_state (i32.const 0x4000) (i32.const 4))
  )

  ;; --- Helper: compute actual string length (find first zero byte or max) ---
  (func $strlen (param $ptr i32) (param $max i32) (result i32)
    (local $i i32)
    (local.set $i (i32.const 0))
    (block $done
      (loop $scan
        (br_if $done (i32.ge_u (local.get $i) (local.get $max)))
        (br_if $done
          (i32.eqz (i32.load8_u (i32.add (local.get $ptr) (local.get $i))))
        )
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $scan)
      )
    )
    (local.get $i)
  )
)
