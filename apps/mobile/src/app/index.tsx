import { Redirect } from "expo-router";
import { useMachines } from "~/lib/machines/store";

export default function Index() {
  const { machines } = useMachines();
  return <Redirect href={machines.length ? "/sessions" : "/connect"} />;
}
