import { describe, it, expect } from "vitest";
import { classifyTask } from "../classifier.js";

const defaultKeywords = {
  code: ["implement", "function", "class", "refactor", "fix", "test", "debug", "PR", "diff", "migration", "component", "endpoint"],
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

  it("score-based matching picks highest-scoring category", () => {
    const result = classifyTask("research this API then implement a client", defaultKeywords, highRisk);
    // 'implement', 'client' (code keywords) appear; 'research' also appears
    // score-based: whichever category has more keyword matches wins
    expect(["research", "code"]).toContain(result.category);
  });

  it("uses workspace hints when no keyword match", () => {
    const result = classifyTask("bunu düzelt", defaultKeywords, highRisk, ["code"]);
    expect(result.category).toBe("code");
  });

  it("does not match substrings — 'information' should not trigger 'format'", () => {
    const result = classifyTask("send me the information about the project", defaultKeywords, highRisk);
    expect(result.category).toBe("default"); // NOT "fast"
  });

  it("does not match substrings — 'classification' should not trigger 'class'", () => {
    const result = classifyTask("the classification of this data is wrong", defaultKeywords, highRisk);
    expect(result.category).toBe("default"); // NOT "code"
  });

  it("does not match substrings — 'contest' should not trigger 'test'", () => {
    const result = classifyTask("enter the contest today", defaultKeywords, highRisk);
    expect(result.category).toBe("default"); // NOT "code"
  });

  it("high-risk uses word boundary — 'endpoint' should not trigger 'deploy'", () => {
    const result = classifyTask("add a new endpoint for the API", defaultKeywords, highRisk);
    expect(result.category).toBe("code"); // "endpoint" matches code
    expect(result.risk).toBe("medium"); // NOT high — "endpoint" does not contain "deploy" as a word
  });

  it("high-risk uses word boundary — 'production' triggers high risk", () => {
    const result = classifyTask("fix the production database", defaultKeywords, highRisk);
    expect(result.risk).toBe("high");
  });

  it("high-risk uses word boundary — 'token' in normal context should not trigger if not in high_risk list", () => {
    const result = classifyTask("parse the JSON token from the response", defaultKeywords, highRisk);
    // "token" is NOT in our default highRisk list (only deploy, delete, drop, rm, production, credentials, secret, password)
    expect(result.risk).not.toBe("high");
  });
});
