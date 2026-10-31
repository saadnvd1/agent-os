// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isFreeTarget } from "./focus";

const mount = (html: string) => {
  document.body.innerHTML = html;
  return (
    document.body.firstElementChild!.querySelector("[data-t]") ??
    document.body.firstElementChild!
  );
};

describe("isFreeTarget", () => {
  it("is free on the page and on a button", () => {
    expect(isFreeTarget(document.body)).toBe(true);
    expect(isFreeTarget(mount("<div><button data-t></button></div>"))).toBe(
      true
    );
    expect(
      isFreeTarget(mount('<div><input data-t type="checkbox"></div>'))
    ).toBe(true);
  });
  it("is not free in a text field", () => {
    expect(isFreeTarget(mount("<div><textarea data-t></textarea></div>"))).toBe(
      false
    );
    expect(isFreeTarget(mount('<div><input data-t type="text"></div>'))).toBe(
      false
    );
    expect(isFreeTarget(mount("<div><select data-t></select></div>"))).toBe(
      false
    );
  });
  it("is not free in an editable region, a terminal, a dialog or a menu", () => {
    expect(
      isFreeTarget(mount('<div><p data-t contenteditable="true"></p></div>'))
    ).toBe(false);
    expect(
      isFreeTarget(
        mount('<div class="xterm"><textarea data-t></textarea></div>')
      )
    ).toBe(false);
    expect(
      isFreeTarget(mount('<div role="dialog"><button data-t></button></div>'))
    ).toBe(false);
    expect(
      isFreeTarget(mount('<div role="menu"><button data-t></button></div>'))
    ).toBe(false);
  });
});
