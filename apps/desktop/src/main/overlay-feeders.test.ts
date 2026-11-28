import { describe, expect, it } from "vitest";
import { MAX_FEEDERS, OverlayFeeders } from "./overlay-feeders";

const live = { instanceId: "live-1", moduleId: "wellbrained.starcraft2", panelType: "live" };
const builds = { instanceId: "builds-1", moduleId: "wellbrained.starcraft2", panelType: "builds" };
const notes = { instanceId: "notes-1", moduleId: "tavora.notes" };
const records = [builds, live, notes];
const card = { moduleId: "wellbrained.starcraft2", workspaceId: "sc2", key: "build-card" };

describe("the panels that feed an overlay", () => {
  it("are every panel of its module until one has published its key, whatever comes first in the layout", () => {
    expect(new OverlayFeeders().of(records, card)).toEqual([builds, live]);
  });

  it("are the one that published its key last, once one has", () => {
    const feeders = new OverlayFeeders();
    expect(feeders.published(card, live.instanceId)).toBe(true);
    expect(feeders.published(card, live.instanceId)).toBe(false);
    expect(feeders.of(records, card)).toEqual([live]);
    // Another key, or the same key in another workspace, is its own.
    expect(feeders.of(records, { ...card, key: "timer" })).toEqual([builds, live]);
    expect(feeders.of(records, { ...card, workspaceId: "other" })).toEqual([builds, live]);
    expect(feeders.published(card, builds.instanceId)).toBe(true);
    expect(feeders.of(records, card)).toEqual([builds]);
  });

  it("are every panel of the module again once that panel is gone", () => {
    const feeders = new OverlayFeeders();
    feeders.published(card, live.instanceId);
    expect(feeders.of([builds, notes], card)).toEqual([builds]);
    feeders.forget(live.instanceId);
    expect(feeders.of(records, card)).toEqual([builds, live]);
  });

  it("keep at most MAX_FEEDERS keys, the oldest going first", () => {
    const feeders = new OverlayFeeders();
    feeders.published(card, live.instanceId);
    for (let i = 0; i < MAX_FEEDERS; i++) feeders.published({ ...card, key: `k${i}` }, live.instanceId);
    expect(feeders.of(records, card)).toEqual([builds, live]);
    expect(feeders.of(records, { ...card, key: `k${MAX_FEEDERS - 1}` })).toEqual([live]);
  });
});
