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
