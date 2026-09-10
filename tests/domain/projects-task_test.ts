import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { Project, Task } from "../../supabase/functions/projects/domain/entities.ts";
import { BusinessRuleError } from "../../supabase/functions/_shared/domain/errors.ts";

const NOW = new Date("2026-04-01T09:00:00Z");
const TENANT = "8ac3d2f0-9a11-4d0e-9d7f-3f0c1a2b3c4d";
const USER = "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9";

function newProject(): Project {
  return Project.create({
    id: "11111111-2222-4333-8444-555555555555",
    tenantId: TENANT,
    name: "Implantacao",
    budgetCents: 1_000_000,
    createdBy: USER,
    now: NOW,
  });
}

function newTask(project = newProject()): Task {
  return Task.create({
    id: "99999999-8888-4777-8666-555555555555",
    tenantId: TENANT,
    project,
    title: "Migrar base de dados",
    createdBy: USER,
    now: NOW,
  });
}

Deno.test("Project deriva o codigo do nome", () => {
  assertEquals(newProject().code, "IMPLAN");
  assertEquals(newProject().status.value, "planning");
});

Deno.test("Project recusa prazo anterior ao inicio", () => {
  assertThrows(
    () =>
      Project.create({
        id: "11111111-2222-4333-8444-555555555555",
        tenantId: TENANT,
        name: "Implantacao",
        startDate: new Date("2026-05-01"),
        dueDate: new Date("2026-04-01"),
        createdBy: USER,
        now: NOW,
      }),
    BusinessRuleError,
  );
});

Deno.test("Project arquivado nao aceita novas tarefas", () => {
  const project = newProject();
  project.changeStatus("archived", NOW);

  assertEquals(project.status.isArchived, true);
  assertThrows(() => newTask(project), BusinessRuleError, "nao aceita novas tarefas");
  assertThrows(() => project.update({ name: "Outro" }, NOW), BusinessRuleError);
});

Deno.test("Project recusa transicao de estado invalida", () => {
  const project = newProject();
  project.changeStatus("archived", NOW);
  assertThrows(() => project.changeStatus("active", NOW), BusinessRuleError);
});

Deno.test("Task nao conclui com subtarefa em aberto", () => {
  const task = newTask();
  assertThrows(
    () => task.changeStatus("done", 2, NOW),
    BusinessRuleError,
    "2 subtarefa(s) em aberto",
  );

  task.changeStatus("done", 0, NOW);
  assertEquals(task.status.value, "done");
  assertEquals(task.completedAt?.toISOString(), NOW.toISOString());
});

Deno.test("Task reaberta limpa a data de conclusao", () => {
  const task = newTask();
  task.changeStatus("done", 0, NOW);
  task.changeStatus("in_progress", 0, NOW);

  assertEquals(task.status.value, "in_progress");
  assertEquals(task.completedAt, null);
});

Deno.test("Task recusa transicao invalida", () => {
  const task = newTask();
  task.changeStatus("cancelled", 0, NOW);
  assertThrows(() => task.changeStatus("done", 0, NOW), BusinessRuleError);
});

Deno.test("Task soma as horas apontadas e enfileira os filhos", () => {
  const task = newTask();
  task.pullEvents();

  task.logTime({ id: "aaaa1111-2222-4333-8444-555555555555", userId: USER, minutes: 90, now: NOW });
  task.logTime({ id: "bbbb1111-2222-4333-8444-555555555555", userId: USER, minutes: 30, now: NOW });
  task.comment({
    id: "cccc1111-2222-4333-8444-555555555555",
    authorId: USER,
    body: "Feito",
    now: NOW,
  });

  assertEquals(task.loggedMinutes, 120);
  assertEquals(task.pullNewTimeEntries().length, 2);
  assertEquals(task.pullNewComments().length, 1);
  assertEquals(task.pullEvents().map((event) => event.name), [
    "projects.time_entry.logged",
    "projects.time_entry.logged",
  ]);
});

Deno.test("Task recusa apontamento acima de um dia", () => {
  const task = newTask();
  assertThrows(() =>
    task.logTime({
      id: "dddd1111-2222-4333-8444-555555555555",
      userId: USER,
      minutes: 2000,
      now: NOW,
    })
  );
});
