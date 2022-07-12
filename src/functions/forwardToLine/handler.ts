import 'dotenv/config';
import fetch from 'node-fetch';
import { App } from '@slack/bolt';
import { Message } from '@slack/web-api/dist/response/ConversationsHistoryResponse';
import { subDays } from 'date-fns';

//
// constants
//
const mentionRegExp = /<@.+>/g;
const LINE_API_URL = 'https://notify-api.line.me/api/notify';

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
const getUserIdFromMentionStr = (mentionStr: string) => mentionStr.replace(/[<>@]/g, '');

const getChannelURL = (channelId: string, slackUrl: string) => {
  const { host: slackUrlHost } = new URL(slackUrl);

  return `https://${slackUrlHost}/archives/${channelId}`;
};

const fetchChannelName = async (channelId: string) => {
  const conversationsInfo = await boltClient.conversations
    .info({ channel: channelId })
    .catch(console.error);
  const { name_normalized: nameNormalized, name } = conversationsInfo?.channel ?? {};

  return nameNormalized ?? name ?? '';
};

const fetchUserName = async (userId: string) => {
  const userInfo = await boltClient.users.info({ user: userId }).catch(console.error);

  const { real_name: realName, name } = userInfo?.user ?? {};
  return realName ?? name ?? '';
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
    .catch(console.error);

  const sortedConversationsHistory = conversationsHistory?.messages?.sort(
    (a, b) => +(a.ts ?? 0) - +(b.ts ?? 0)
  );

  return sortedConversationsHistory ?? [];
};

const fetchLatestUpdates = async (
  slackUrl: string,
  channelIds: string[],
  forwardedDays: number,
  maxMessagesInChannel?: number
) => {
  const messagesOldestTimestamp = subDays(new Date(), forwardedDays).getTime() / 1000;

  const conversationsHistoryList = await Promise.all(
    channelIds.map(async (channelId) => {
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

const replaceMentions = async (text: string) => {
  if (!mentionRegExp.test(text)) {
    return text;
  }

  const mentionedUserIds =
    text.match(mentionRegExp)?.map((mentionStr) => getUserIdFromMentionStr(mentionStr)) ?? [];

  const mentionedUsers = await Promise.all(
    mentionedUserIds.map(async (mentionedUserId) => {
      const mentionedUserName = await fetchUserName(mentionedUserId);

      return [mentionedUserId, mentionedUserName] as const;
    })
  ).then((mentionedUserEntries) => new Map(mentionedUserEntries));

  return text.replace(mentionRegExp, (mentionStr) => {
    const userId = getUserIdFromMentionStr(mentionStr);

    return mentionedUsers.get(userId) ?? '';
  });
};

const composeForwardedMessage = async (message: Message, maxMessageLength?: number) => {
  const { text, user } = message;
  if (!text || !user) {
    return '';
  }

  const slicedText = text.slice(0, maxMessageLength);
  const slicedTextWithMentionsReplaced = await replaceMentions(slicedText);
  const userName = await fetchUserName(user);

  return `${userName}さんの投稿\n${slicedTextWithMentionsReplaced}`;
};

const composeForwardedContent = async (
  conversationsHistoryList: {
    channelName: string;
    channelUrl: string;
    messages: Message[];
  }[],
  maxMessageLength?: number
) =>
  Promise.all(
    conversationsHistoryList.map(async ({ channelName, channelUrl, messages }) => {
      if (!messages.length) {
        return '';
      }

      const composedMessages = await Promise.all(
        messages.map(async (message) => composeForwardedMessage(message, maxMessageLength))
      );

      const joinedMessages = composedMessages.filter((message) => message).join('\n\n');

      return `${channelName}に新着投稿があります\n\n${joinedMessages}\n\nslackで確認\n${channelUrl}`;
    })
  ).then((forwardedContents) => forwardedContents.filter((content) => content));

const notifyLine = async (content: string, lineNotifyAccessToken: string) => {
  const body = new URLSearchParams({ message: content });

  return fetch(LINE_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${lineNotifyAccessToken}`,
    },
    body,
  })
    .then((res) => res.status)
    .catch(console.error);
};

const handleNotifiedContents = async (contents: string[], lineNotifyAccessTokens: string[]) =>
  Promise.all(
    contents.map(async (content) =>
      Promise.all(lineNotifyAccessTokens.map(async (token) => notifyLine(content, token)))
    )
  ).then((statusCodes) => statusCodes.flat());

//
// main
//
export const main = async () => {
  // eslint-disable-next-line no-console
  console.log('starting process...', new Date().toISOString());

  const conversationsHistoryList = await fetchLatestUpdates(
    process.env.SLACK_URL ?? '',
    process.env.FORWARDED_CHANNEL_IDS?.split(' ') ?? [],
    +(process.env.FORWARDED_DAYS ?? 7),
    process.env.MAX_MESSAGES_IN_CHANNEL as number | undefined
  );
  // eslint-disable-next-line no-console
  console.log('conversationsHistoryList.length:', conversationsHistoryList.length);

  const forwardedContents = await composeForwardedContent(
    conversationsHistoryList,
    process.env.MAX_MESSAGE_LENGTH as number | undefined
  );

  const result = await handleNotifiedContents(
    forwardedContents,
    process.env.LINE_NOTIFY_ACCESS_TOKENS?.split(' ') ?? []
  )
    .then((statusCodes) => {
      // eslint-disable-next-line no-console
      console.log('done', new Date().toISOString());

      // eslint-disable-next-line no-console
      console.log('statusCodes:', statusCodes);

      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'DONE' }),
      };
    })
    .catch((e) => {
      console.error(e);
      return {
        statusCode: 500,
        body: JSON.stringify({ message: e }),
      };
    });

  return result;
};
