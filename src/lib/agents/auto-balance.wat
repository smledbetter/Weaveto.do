(module
  ;; Auto-Balance Agent
  ;; Assigns unassigned tasks to the member with the fewest pending tasks.
  ;; Uses host_get_assignment_data (binary format) and host_emit_assignment (host builds JSON).

  ;; --- Host imports ---
  (import "env" "memory" (memory 1))
  (import "env" "host_get_assignment_data" (func $get_data (param i32 i32) (result i32)))
  (import "env" "host_emit_assignment" (func $emit_assign (param i32 i32 i32 i32)))
  (import "env" "host_log" (func $host_log (param i32 i32)))
  (import "env" "host_get_now" (func $get_now (result i32)))
  (import "env" "host_get_state" (func $get_state (param i32 i32) (result i32)))
  (import "env" "host_set_state" (func $set_state (param i32 i32)))
  (import "env" "host_get_event" (func $get_event (param i32 i32) (result i32)))
  (import "env" "host_get_tasks" (func $get_tasks (param i32 i32) (result i32)))
  (import "env" "host_get_members" (func $get_members (param i32 i32) (result i32)))
  (import "env" "host_emit_event" (func $emit_event (param i32 i32)))

  ;; --- Constants ---
  ;; Binary format sizes (must match runtime.ts TASK_ID_SIZE, MEMBER_KEY_SIZE, etc.)
  ;; Task record: 36 bytes taskId + 1 byte isBlocked = 37 bytes
  ;; Member record: 36 bytes identityKey + 4 bytes load + 4 bytes lastActive = 44 bytes
  ;; Header: 4 bytes unassignedCount + 4 bytes memberCount = 8 bytes

  ;; Memory layout:
  ;;   0x0000 - 0x1FFF : assignment data buffer (8KB)
  ;;   0x2000 - 0x2003 : last-run timestamp (4 bytes, persisted state)

  ;; --- Exports ---
  (export "init" (func $init))
  (export "on_task_event" (func $on_task_event))
  (export "on_tick" (func $on_tick))

  ;; --- init: load persisted state ---
  (func $init
    ;; Load last-run timestamp from persistent state
    (drop (call $get_state (i32.const 0x2000) (i32.const 4)))
  )

  ;; --- on_task_event: no-op (we only act on tick) ---
  (func $on_task_event)

  ;; --- on_tick: main auto-balance logic ---
  (func $on_tick
    (local $data_len i32)
    (local $task_count i32)
    (local $member_count i32)
    (local $task_offset i32)
    (local $member_start i32)
    (local $i i32)
    (local $j i32)
    (local $is_blocked i32)
    (local $member_offset i32)
    (local $load i32)
    (local $min_load i32)
    (local $best_offset i32)
    (local $task_id_ptr i32)
    (local $task_id_len i32)
    (local $best_key_ptr i32)
    (local $best_key_len i32)

    ;; Fetch assignment data into buffer at 0x0000
    (local.set $data_len (call $get_data (i32.const 0) (i32.const 0x2000)))

    ;; Early exit if no data
    (if (i32.eqz (local.get $data_len)) (then (return)))

    ;; Parse header
    (local.set $task_count (i32.load (i32.const 0)))
    (local.set $member_count (i32.load (i32.const 4)))

    ;; Early exit if no tasks or no members
    (if (i32.eqz (local.get $task_count)) (then (return)))
    (if (i32.eqz (local.get $member_count)) (then (return)))

    ;; Calculate where member records start
    ;; member_start = 8 + (task_count * 37)
    (local.set $member_start
      (i32.add
        (i32.const 8)
        (i32.mul (local.get $task_count) (i32.const 37))
      )
    )

    ;; Loop through each task
    (local.set $task_offset (i32.const 8))
    (local.set $i (i32.const 0))
    (block $task_done
      (loop $task_loop
        ;; Exit when all tasks processed
        (br_if $task_done (i32.ge_u (local.get $i) (local.get $task_count)))

        ;; Check isBlocked flag (byte at task_offset + 36)
        (local.set $is_blocked
          (i32.load8_u (i32.add (local.get $task_offset) (i32.const 36)))
        )

        ;; Skip blocked tasks
        (if (i32.eqz (local.get $is_blocked))
          (then
            ;; --- Find member with lowest load ---
            (local.set $min_load (i32.const 0x7FFFFFFF))  ;; INT_MAX
            (local.set $best_offset (local.get $member_start))
            (local.set $member_offset (local.get $member_start))
            (local.set $j (i32.const 0))

            (block $member_done
              (loop $member_loop
                (br_if $member_done (i32.ge_u (local.get $j) (local.get $member_count)))

                ;; Read load at member_offset + 36
                (local.set $load
                  (i32.load (i32.add (local.get $member_offset) (i32.const 36)))
                )

                ;; If this member has strictly lower load, pick them
                (if (i32.lt_u (local.get $load) (local.get $min_load))
                  (then
                    (local.set $min_load (local.get $load))
                    (local.set $best_offset (local.get $member_offset))
                  )
                )

                ;; Advance to next member (44 bytes per record)
                (local.set $member_offset
                  (i32.add (local.get $member_offset) (i32.const 44))
                )
                (local.set $j (i32.add (local.get $j) (i32.const 1)))
                (br $member_loop)
              )
            )

            ;; --- Compute actual taskId length (strip zero-padding) ---
            (local.set $task_id_ptr (local.get $task_offset))
            (local.set $task_id_len (call $strlen (local.get $task_id_ptr) (i32.const 36)))

            ;; --- Compute actual identityKey length (strip zero-padding) ---
            (local.set $best_key_ptr (local.get $best_offset))
            (local.set $best_key_len (call $strlen (local.get $best_key_ptr) (i32.const 36)))

            ;; --- Emit assignment ---
            (call $emit_assign
              (local.get $task_id_ptr)
              (local.get $task_id_len)
              (local.get $best_key_ptr)
              (local.get $best_key_len)
            )

            ;; --- Increment the chosen member's load in-memory ---
            ;; This ensures subsequent tasks in the same tick see the updated load.
            (i32.store
              (i32.add (local.get $best_offset) (i32.const 36))
              (i32.add (local.get $min_load) (i32.const 1))
            )
          )
        )

        ;; Advance to next task (37 bytes per record)
        (local.set $task_offset
          (i32.add (local.get $task_offset) (i32.const 37))
        )
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $task_loop)
      )
    )

    ;; Save last-run timestamp to persistent state
    (i32.store (i32.const 0x2000) (call $get_now))
    (call $set_state (i32.const 0x2000) (i32.const 4))
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
