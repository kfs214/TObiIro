import "dotenv/config";
import { App } from "@slack/bolt";
import { Message } from "@slack/web-api/dist/response/ConversationsHistoryResponse";
import { subDays } from "date-fns";

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
const getChannelURL = (channelId: string, slackUrl: string) => {
  const { host: slackUrlHost } = new URL(slackUrl);

  return `https://${slackUrlHost}/archives/${channelId}`;
};

const fetchChannelName = async (channelId: string) => {
  const conversationsInfo = await boltClient.conversations
    .info({ channel: channelId })
    .catch((e) => {
      console.log(e);
    });
  const { name_normalized: nameNormalized, name } =
    conversationsInfo?.channel ?? {};

  return nameNormalized ?? name ?? "";
};

const fetchLatestMessages = async (
  channelId: string,
  messagesOldestTimestamp: number,
  maxMessagesInChannel?: number
) => {
  const conversationsHistory = await boltClient.conversations
    .history({
      channel: channelId,
      limit: maxMessagesInChannel,
      oldest: `${messagesOldestTimestamp}`,
    })
    .catch((e) => {
      console.log(e);
    });

  console.log("conversationsHistory", conversationsHistory);

  return conversationsHistory?.messages ?? [];
};

const fetchLatestUpdates = async (
  slackUrl: string,
  channelIds: string[],
  forwardedDays: number,
  maxMessagesInChannel?: number
) => {
  const messagesOldestTimestamp =
    subDays(new Date(), forwardedDays).getTime() / 1000;

  const conversationsHistoryList = await Promise.all(
    await channelIds.map(async (channelId) => {
      const channelName = await fetchChannelName(channelId);
      const channelUrl = getChannelURL(channelId, slackUrl);
      const messages = await fetchLatestMessages(
        channelId,
        messagesOldestTimestamp,
        maxMessagesInChannel
      );

      return { channelName, channelUrl, messages };
    })
  );

  return conversationsHistoryList;
};

const composeForwardedContent = (
  conversationsHistoryList: {
    channelName: string;
    channelUrl: string;
    messages: Message[];
  }[],
  maxMessageLength?: number
) =>
  conversationsHistoryList.map(({ channelName, channelUrl, messages }) => {
    if (!messages.length) {
      return "";
    }
    const joinedMessages = messages
      .map((message) => message.text?.slice(0, maxMessageLength))
      .join("\n");

    return `${channelName}に新着投稿があります\n\n${joinedMessages}\n\nslackで確認\n${channelUrl}`;
  });
//
// main
//
const main = async () => {
  console.log("starting process...", new Date().toISOString());

  const conversationsHistoryList = await fetchLatestUpdates(
    process.env.SLACK_URL ?? "",
    process.env.FORWARDED_CHANNEL_IDS?.split(" ") ?? [],
    +(process.env.FORWARDED_DAYS ?? 7),
    process.env.MAX_MESSAGES_IN_CHANNEL as number | undefined
  );
  console.log(
    "conversationsHistoryList.length:",
    conversationsHistoryList.length
  );

  // TODO collaさんは「CollaさんからN件」とする
  // TODO メンションを名前で置換したい users.info users:read
  // TODO 投稿者名も欲しい  Message['user']

  const forwardedContents = composeForwardedContent(
    conversationsHistoryList,
    process.env.MAX_MESSAGE_LENGTH as number | undefined
  );
  console.log("forwardedContents\n", forwardedContents);
};
main();
