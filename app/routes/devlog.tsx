import { redirect, type LoaderFunctionArgs } from "react-router";

import { getDateKey } from "~/lib/ledger-entry";

export const loader = async (_args: LoaderFunctionArgs) => {
  return redirect(`/devlog/${getDateKey(new Date())}`);
};

export default function DevlogIndexRedirect() {
  return null;
}
