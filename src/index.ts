import "dotenv/config";
import { App } from "@slack/bolt";
import { Message } from "@slack/web-api/dist/response/ConversationsHistoryResponse";
import { subDays } from "date-fns";

//
// Types
//

//
// instances
//
const { client: boltClient } = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  token: process.env.SLACK_TOKEN,
});

//
// Functions
//
const fetchLatestMessages = async (
  channelIds: string[],
  forwardedDays: number,
  maxMessagesInChannel?: number
) => {
  const messagesOldestTimestamp =
    subDays(new Date(), forwardedDays).getTime() / 1000;

  const conversationsHistoryMessages = await Promise.all(
    await channelIds.map(async (channelId) => {
      const res = await boltClient.conversations
        .history({
          channel: channelId,
          limit: maxMessagesInChannel,
          oldest: `${messagesOldestTimestamp}`,
        })
        .catch((e) => {
          console.log(e);
        });

      return res;
    })
  ).then((results) =>
    results.flatMap((result) => result?.messages).filter((result) => result)
  );

  return conversationsHistoryMessages as Message[];
};

const composeForwardedContent = (
  messages: Message[],
  maxMessageLength?: number
) =>
  messages
    .map((message) => message.text?.slice(0, maxMessageLength))
    .join("\n");

//
// main
//
const main = async () => {
  console.log("starting process...", new Date().toISOString());

  const conversationsHistoryMessages = await fetchLatestMessages(
    process.env.FORWARDED_CHANNEL_IDS?.split(" ") ?? [],
    +(process.env.FORWARDED_DAYS ?? 7),
    process.env.MAX_MESSAGES_IN_CHANNEL as number | undefined
  );
  console.log(
    "conversationsHistoryMessages.length:",
    conversationsHistoryMessages.length
  );

  // TODO 内容を精査・改善（API呼び出しの時点で伝わりにくい切り取られ方をしている）
  const forwardedContent = composeForwardedContent(
    conversationsHistoryMessages,
    process.env.MAX_MESSAGE_LENGTH as number | undefined
  );
  console.log("forwardedContent\n", forwardedContent);
};
main();
