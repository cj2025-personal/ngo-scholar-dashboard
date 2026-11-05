"use strict";
process.env.MONGODB_URI ||= "mongodb://localhost:27017";
process.env.MONGODB_DB ||= "audience-grade-test";

/*
 * The grade the article itself is written at, on the public read
 * (provenance.audienceGrade, 2026-11-05). Each level already carried its own
 * grade; the article did not, so the learner app could not say what grade a
 * reading check for the article itself should be written at.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { audienceGradeOf } = require("../src/services/editorial.service");
const { AUDIENCES } = require("../src/lib/audiences");

test("an article's grade is its band's grade, from the one table levels use", () => {
  for (const key of Object.keys(AUDIENCES)) {
    assert.equal(audienceGradeOf({ audience: key }), AUDIENCES[key].grade, key);
  }
});

test("a story with no recorded band is the adults', as everywhere else", () => {
  assert.equal(audienceGradeOf({}), AUDIENCES.adults.grade);
  assert.equal(audienceGradeOf(null), AUDIENCES.adults.grade);
  assert.equal(audienceGradeOf({ audience: "not-a-band" }), AUDIENCES.adults.grade);
});
