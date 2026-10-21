// `[--name "x"] <project> [--name "x"] <prompt...>`: the flag counts only
// before the prompt starts, so a prompt may mention --name.
function parseSpawnArgs(words, fail) {
  let name;
  let on;
  let after;
  let terminal = false;
  let planOnly = false;
  let piece;
  let priority;
  let onMac = false;
  let group;
  let role;
  let project;
  let i = 0;
  for (; i < words.length; i++) {
    const w = words[i];
    if (w === "--name") {
      name = words[++i];
      if (name === undefined) fail("--name needs a value");
    } else if (w.startsWith("--name=")) name = w.slice(7);
    else if (w === "--on") {
      on = words[++i];
      if (on === undefined) fail("--on needs a machine");
    } else if (w.startsWith("--on=")) on = w.slice(5);
    else if (w === "--after") {
      after = words[++i];
      if (after === undefined) fail('--after needs a task or "any"');
    } else if (w.startsWith("--after=")) after = w.slice(8);
    else if (w === "--terminal") terminal = true;
    else if (w === "--plan-only") planOnly = true;
    else if (w === "--on-mac") onMac = true;
    else if (w === "--piece") {
      piece = words[++i];
      if (piece === undefined) fail("--piece needs a piece name");
    } else if (w.startsWith("--piece=")) piece = w.slice(8);
    else if (w === "--priority") {
      priority = words[++i];
      if (priority === undefined) fail("--priority needs a value");
    } else if (w.startsWith("--priority=")) priority = w.slice(11);
    else if (w === "--group") {
      group = words[++i];
      if (group === undefined) fail("--group needs a group name");
    } else if (w.startsWith("--group=")) group = w.slice(8);
    else if (w === "--role") {
      role = words[++i];
      if (role === undefined)
        fail("--role needs developer, analyst, reviewer or supervisor");
    } else if (w.startsWith("--role=")) role = w.slice(7);
    else if (project === undefined) project = w;
    else break;
  }
  return {
    name: name?.trim() || undefined,
    on: on?.trim() || undefined,
    after: after?.trim() || undefined,
    terminal,
    planOnly,
    piece: piece?.trim() || undefined,
    priority: priority?.trim().toLowerCase() || undefined,
    onMac,
    group: group?.trim() || undefined,
    role: role?.trim().toLowerCase() || undefined,
    project,
    prompt: words.slice(i),
  };
}

module.exports = parseSpawnArgs;
