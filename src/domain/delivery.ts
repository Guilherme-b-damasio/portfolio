/** Where an image build stands, as the deploys timeline shows it. */
export type BuildStatus = "queued" | "running" | "success" | "failure" | "cancelled";

/** One push to the deployed branch and the image build it started. */
export interface BuildView {
  sha: string;
  message: string; // first line of the head commit, capped
  author: string;
  committedAt: string | null;
  status: BuildStatus;
  startedAt: string;
  finishedAt: string | null; // null while the build is queued or running
  url: string; // the run on GitHub Actions
}

/** The latest image builds of the deployed branch, newest first. Read-only and public. */
export interface BuildHistory {
  builds(): Promise<BuildView[]>;
}

/** The build history could not be read right now. Its message is written for the visitor. */
export class DeliveryUnavailable extends Error {
  override name = "DeliveryUnavailable";
}

/** One revision of the deployment: the ReplicaSet a rollout created, and when its pod came up. */
export interface RolloutView {
  revision: number;
  image: string;
  sha: string | null; // the short sha in a `<timestamp>-<sha>` tag; null for any other tag
  startedAt: string | null; // when the ReplicaSet was created, i.e. when the new image was applied
  readyAt: string | null; // when its newest pod turned Ready; null once the revision is scaled away
  replicas: string; // ready/desired, as kubectl prints it
  current: boolean; // the newest revision, the one the deployment asks for now
}

/** The deployment's recent revisions, newest first. Read-only. */
export interface RolloutHistory {
  rollouts(): Promise<RolloutView[]>;
}

/** The moment Flux's image automation picked a new tag, before it rewrote the deployment. */
export interface TagSelectionView {
  tag: string;
  sha: string | null; // the short sha in a `<timestamp>-<sha>` tag; null for any other tag
  selectedAt: string;
}

/** The tags the ImagePolicy picked recently, newest first. Read-only; the cluster keeps these for about an hour. */
export interface TagSelectionHistory {
  selections(): Promise<TagSelectionView[]>;
}
