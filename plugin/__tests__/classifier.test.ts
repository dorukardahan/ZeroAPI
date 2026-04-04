import { describe, it, expect } from "vitest";
import { classifyTask } from "../classifier.js";

const defaultKeywords = {
  code: ["implement", "function", "class", "refactor", "fix", "test", "debug", "PR", "diff", "migration", "component", "endpoint", "deploy"],
  research: ["research", "analyze", "explain", "compare", "paper", "evidence", "investigate", "study"],
  orchestration: ["orchestrate", "coordinate", "pipeline", "workflow", "sequence", "parallel", "fan-out"],
  math: ["calculate", "solve", "equation", "proof", "integral", "probability", "optimize", "formula"],
  fast: ["quick", "simple", "format", "convert", "translate", "rename", "one-liner", "list"],
};

const highRisk = ["deploy", "delete", "drop", "rm", "production", "credentials", "secret", "password"];

describe("classifyTask", () => {
  it("classifies code tasks", () => {
    const result = classifyTask("refactor the auth module", defaultKeywords, highRisk);
    expect(result.category).toBe("code");
    expect(result.risk).toBe("medium");
  });

  it("classifies research tasks", () => {
    const result = classifyTask("research the differences between SQLite WAL modes", defaultKeywords, highRisk);
    expect(result.category).toBe("research");
  });

  it("classifies orchestration tasks", () => {
    const result = classifyTask("orchestrate a pipeline that fetches data then transforms it", defaultKeywords, highRisk);
    expect(result.category).toBe("orchestration");
  });

  it("classifies math tasks", () => {
    const result = classifyTask("solve this integral equation", defaultKeywords, highRisk);
    expect(result.category).toBe("math");
  });

  it("classifies fast tasks", () => {
    const result = classifyTask("quickly format this as a table", defaultKeywords, highRisk);
    expect(result.category).toBe("fast");
  });

  it("returns default for ambiguous input", () => {
    const result = classifyTask("buna bi bak", defaultKeywords, highRisk);
    expect(result.category).toBe("default");
  });

  it("returns default for empty input", () => {
    const result = classifyTask("", defaultKeywords, highRisk);
    expect(result.category).toBe("default");
  });

  it("detects high risk keywords", () => {
    const result = classifyTask("deploy this to production", defaultKeywords, highRisk);
    expect(result.risk).toBe("high");
  });

  it("code is medium risk by default", () => {
    const result = classifyTask("write a function that parses JSON", defaultKeywords, highRisk);
    expect(result.category).toBe("code");
    expect(result.risk).toBe("medium");
  });

  it("fast is low risk", () => {
    const result = classifyTask("convert this to markdown", defaultKeywords, highRisk);
    expect(result.risk).toBe("low");
  });

  it("handles Turkish text with English keywords", () => {
    const result = classifyTask("bu fonksiyonu refactor et", defaultKeywords, highRisk);
    expect(result.category).toBe("code");
  });

  it("first keyword match wins for multi-category", () => {
    const result = classifyTask("research this API then implement a client", defaultKeywords, highRisk);
    expect(result.category).toBe("research");
  });

  it("uses workspace hints when no keyword match", () => {
    const result = classifyTask("bunu düzelt", defaultKeywords, highRisk, ["code"]);
    expect(result.category).toBe("code");
  });
});
