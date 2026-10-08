import Editor from "../components/Editor";
import { requireChatGPTUser } from "./chatgpt-auth";
export default async function Home() {
  await requireChatGPTUser("/");
  return <Editor />;
}
