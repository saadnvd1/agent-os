// Stands in for an agent inside a demo tmux pane: prints a prepared screen,
// pinned to the bottom like a real scrolled terminal, sets the pane title the
// way Claude Code does, and redraws on resize. It is a node process, so the
// pane never looks like a bare shell.
import fs from "fs";

const [screenFile, title = ""] = process.argv.slice(2);
const screen = fs.readFileSync(screenFile, "utf8").replace(/\n+$/, "");
const lines = screen.split("\n");

function draw() {
  const rows = process.stdout.rows || 40;
  const pad = Math.max(0, rows - lines.length - 1);
  process.stdout.write(
    `\x1b]2;${title}\x07\x1b[?25l\x1b[2J\x1b[H${"\n".repeat(pad)}${screen}`
  );
}

draw();
process.stdout.on("resize", draw);
process.stdin.resume();
setInterval(() => {}, 1 << 30);
