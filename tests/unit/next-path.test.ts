// @vitest-environment node
import { expect, test } from "vitest";
import { safeNextPath, withNext } from "@/lib/next-path";

test("keeps a path on this site, query and all", () => {
  expect(safeNextPath("/device?user_code=ABCDEFGH")).toBe(
    "/device?user_code=ABCDEFGH",
  );
});

test.each([
  undefined,
  ["/device", "/"],
  "",
  "device",
  "https://evil.example/",
  "//evil.example",
  "/\\evil.example",
  "/\t/evil.example",
  "//[",
])("falls back to / for %j", (next) => {
  expect(safeNextPath(next)).toBe("/");
});

test("withNext only adds the parameter when it goes somewhere", () => {
  expect(withNext("/signup", "/")).toBe("/signup");
  expect(withNext("/signup", "/device?user_code=AB")).toBe(
    "/signup?next=%2Fdevice%3Fuser_code%3DAB",
  );
});
