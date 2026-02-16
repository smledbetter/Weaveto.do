import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseTaskCommand } from "$lib/tasks/parser";

const ACTOR_ID = "actor-aaa";

describe("parseTaskCommand", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "mock-uuid-1" as `${string}-${string}-${string}-${string}-${string}`,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("simple task creation", () => {
    it("parses /task Title into a single task_created event", () => {
      const result = parseTaskCommand("/task Buy groceries", ACTOR_ID);
      expect(result).not.toBeNull();
      expect(result!.events).toHaveLength(1);
      expect(result!.events[0].type).toBe("task_created");
      expect(result!.events[0].task?.title).toBe("Buy groceries");
      expect(result!.events[0].task?.status).toBe("pending");
      expect(result!.events[0].actorId).toBe(ACTOR_ID);
    });

    it("trims whitespace from title", () => {
      const result = parseTaskCommand("/task   Trim me   ", ACTOR_ID);
      expect(result!.events[0].task?.title).toBe("Trim me");
    });
  });

  describe("subtask splitting", () => {
    it("parses split into directive as parent + subtasks", () => {
      const result = parseTaskCommand(
        "/task Event prep | split into: design, print, distribute",
        ACTOR_ID,
      );
      expect(result).not.toBeNull();
      expect(result!.events).toHaveLength(4); // 1 parent + 3 subtasks
      expect(result!.events[0].type).toBe("task_created");
      expect(result!.events[0].task?.title).toBe("Event prep");
      expect(result!.events[1].type).toBe("subtask_created");
      expect(result!.events[1].task?.title).toBe("design");
      expect(result!.events[1].task?.parentId).toBe(result!.events[0].taskId);
      expect(result!.events[2].task?.title).toBe("print");
      expect(result!.events[3].task?.title).toBe("distribute");
    });

    it("filters out empty subtask names", () => {
      const result = parseTaskCommand(
        "/task Parent | split into: a, , b, ,",
        ACTOR_ID,
      );
      expect(result!.events).toHaveLength(3); // 1 parent + 2 subtasks
    });
  });

  describe("due date parsing", () => {
    it("parses due: 2h as dueAt timestamp", () => {
      const before = Date.now();
      const result = parseTaskCommand("/task Print flyers | due: 2h", ACTOR_ID);
      const after = Date.now();

      expect(result).not.toBeNull();
      expect(result!.events).toHaveLength(1);
      const dueAt = result!.events[0].task?.dueAt;
      expect(dueAt).toBeDefined();
      // Should be approximately now + 2 hours
      expect(dueAt).toBeGreaterThanOrEqual(before + 2 * 3600000);
      expect(dueAt).toBeLessThanOrEqual(after + 2 * 3600000);
    });

    it("parses due: 30m", () => {
      const before = Date.now();
      const result = parseTaskCommand("/task Quick task | due: 30m", ACTOR_ID);
      const dueAt = result!.events[0].task?.dueAt;
      expect(dueAt).toBeGreaterThanOrEqual(before + 30 * 60000);
    });

    it("parses due: 1d", () => {
      const before = Date.now();
      const result = parseTaskCommand("/task Later | due: 1d", ACTOR_ID);
      const dueAt = result!.events[0].task?.dueAt;
      expect(dueAt).toBeGreaterThanOrEqual(before + 86400000);
    });
  });

  describe("non-task messages", () => {
    it("returns null for regular messages", () => {
      expect(parseTaskCommand("Hello world", ACTOR_ID)).toBeNull();
    });

    it("returns null for messages starting with / but not /task", () => {
      expect(parseTaskCommand("/help", ACTOR_ID)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseTaskCommand("", ACTOR_ID)).toBeNull();
    });
  });

  describe("validation errors", () => {
    it("returns error for /task with no title", () => {
      const result = parseTaskCommand("/task", ACTOR_ID);
      expect(result).not.toBeNull();
      expect(result!.error).toBeDefined();
      expect(result!.events).toHaveLength(0);
    });

    it("returns error for /task with only whitespace", () => {
      const result = parseTaskCommand("/task   ", ACTOR_ID);
      expect(result).not.toBeNull();
      expect(result!.error).toBeDefined();
      expect(result!.events).toHaveLength(0);
    });

    it("returns error for invalid due format", () => {
      const result = parseTaskCommand(
        "/task Test | due: flibbertigibbet",
        ACTOR_ID,
      );
      expect(result).not.toBeNull();
      expect(result!.error).toBeDefined();
      expect(result!.events).toHaveLength(0);
    });

    it("parses natural language due date 'tomorrow'", () => {
      const result = parseTaskCommand("/task Test | due: tomorrow", ACTOR_ID);
      expect(result).not.toBeNull();
      expect(result!.error).toBeUndefined();
      expect(result!.events).toHaveLength(1);
      expect(result!.events[0].task?.dueAt).toBeDefined();
    });
  });

  describe("urgent and description directives", () => {
    it("parses urgent flag", () => {
      const result = parseTaskCommand("/task Fix bug | urgent", ACTOR_ID);
      expect(result).not.toBeNull();
      expect(result!.events).toHaveLength(1);
      expect(result!.events[0].task?.urgent).toBe(true);
      expect(result!.events[0].task?.title).toBe("Fix bug");
    });

    it("parses description", () => {
      const result = parseTaskCommand(
        "/task Fix bug | desc: Details here",
        ACTOR_ID,
      );
      expect(result).not.toBeNull();
      expect(result!.events).toHaveLength(1);
      expect(result!.events[0].task?.description).toBe("Details here");
      expect(result!.events[0].task?.title).toBe("Fix bug");
    });

    it("parses urgent + description + due", () => {
      const result = parseTaskCommand(
        "/task Deploy v2 | urgent | due: tomorrow | desc: Production release",
        ACTOR_ID,
      );
      expect(result).not.toBeNull();
      expect(result!.events).toHaveLength(1);
      expect(result!.events[0].task?.urgent).toBe(true);
      expect(result!.events[0].task?.description).toBe("Production release");
      expect(result!.events[0].task?.dueAt).toBeDefined();
      expect(result!.events[0].task?.title).toBe("Deploy v2");
    });

    it("urgent flag is case-insensitive", () => {
      const result1 = parseTaskCommand("/task Test | Urgent", ACTOR_ID);
      expect(result1!.events[0].task?.urgent).toBe(true);

      const result2 = parseTaskCommand("/task Test | URGENT", ACTOR_ID);
      expect(result2!.events[0].task?.urgent).toBe(true);

      const result3 = parseTaskCommand("/task Test | uRgEnT", ACTOR_ID);
      expect(result3!.events[0].task?.urgent).toBe(true);
    });

    it("description preserves whitespace", () => {
      const result = parseTaskCommand(
        "/task Test | desc: line one   two",
        ACTOR_ID,
      );
      expect(result).not.toBeNull();
      expect(result!.events[0].task?.description).toBe("line one   two");
    });

    it("task without directives has no urgent or description", () => {
      const result = parseTaskCommand("/task Simple task", ACTOR_ID);
      expect(result).not.toBeNull();
      expect(result!.events).toHaveLength(1);
      expect(result!.events[0].task?.urgent).toBeUndefined();
      expect(result!.events[0].task?.description).toBeUndefined();
    });

    it("directives can be in any order", () => {
      const result1 = parseTaskCommand(
        "/task Test | desc: First | urgent | due: 2h",
        ACTOR_ID,
      );
      expect(result1!.events[0].task?.urgent).toBe(true);
      expect(result1!.events[0].task?.description).toBe("First");
      expect(result1!.events[0].task?.dueAt).toBeDefined();

      const result2 = parseTaskCommand(
        "/task Test | due: 2h | desc: Second | urgent",
        ACTOR_ID,
      );
      expect(result2!.events[0].task?.urgent).toBe(true);
      expect(result2!.events[0].task?.description).toBe("Second");
      expect(result2!.events[0].task?.dueAt).toBeDefined();
    });

    it("description is case-insensitive for directive keyword", () => {
      const result1 = parseTaskCommand("/task Test | Desc: Info", ACTOR_ID);
      expect(result1!.events[0].task?.description).toBe("Info");

      const result2 = parseTaskCommand("/task Test | DESC: Info", ACTOR_ID);
      expect(result2!.events[0].task?.description).toBe("Info");
    });
  });
});
