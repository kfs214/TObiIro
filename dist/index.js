"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const node_cron_1 = __importDefault(require("node-cron"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const bolt_1 = require("@slack/bolt");
const date_fns_1 = require("date-fns");
//
// constants
//
const mentionRegExp = /<@.+>/g;
const LINE_API_URL = 'https://notify-api.line.me/api/notify';
const DEFAULT_CRON_SETTING = '0 0 * * 6';
//
// instances
//
const { client: boltClient } = new bolt_1.App({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    token: process.env.SLACK_TOKEN,
});
//
// Functions
//
const getUserIdFromMentionStr = (mentionStr) => mentionStr.replace(/[<>@]/g, '');
const getChannelURL = (channelId, slackUrl) => {
    const { host: slackUrlHost } = new URL(slackUrl);
    return `https://${slackUrlHost}/archives/${channelId}`;
};
const fetchChannelName = (channelId) => __awaiter(void 0, void 0, void 0, function* () {
    var _b, _c;
    const conversationsInfo = yield boltClient.conversations
        .info({ channel: channelId })
        .catch((e) => {
        console.error(e);
    });
    const { name_normalized: nameNormalized, name } = (_b = conversationsInfo === null || conversationsInfo === void 0 ? void 0 : conversationsInfo.channel) !== null && _b !== void 0 ? _b : {};
    return (_c = nameNormalized !== null && nameNormalized !== void 0 ? nameNormalized : name) !== null && _c !== void 0 ? _c : '';
});
const fetchUserName = (userId) => __awaiter(void 0, void 0, void 0, function* () {
    var _d, _e;
    const userInfo = yield boltClient.users.info({ user: userId }).catch((e) => {
        console.error(e);
    });
    const { real_name: realName, name } = (_d = userInfo === null || userInfo === void 0 ? void 0 : userInfo.user) !== null && _d !== void 0 ? _d : {};
    return (_e = realName !== null && realName !== void 0 ? realName : name) !== null && _e !== void 0 ? _e : '';
});
const fetchLatestMessages = (channelId, messagesOldestTimestamp, maxMessagesInChannel) => __awaiter(void 0, void 0, void 0, function* () {
    var _f;
    const conversationsHistory = yield boltClient.conversations
        .history({
        channel: channelId,
        limit: maxMessagesInChannel,
        oldest: `${messagesOldestTimestamp}`,
    })
        .catch((e) => {
        console.error(e);
    });
    const sortedConversationsHistory = (_f = conversationsHistory === null || conversationsHistory === void 0 ? void 0 : conversationsHistory.messages) === null || _f === void 0 ? void 0 : _f.sort((a, b) => { var _a, _b; return +((_a = a.ts) !== null && _a !== void 0 ? _a : 0) - +((_b = b.ts) !== null && _b !== void 0 ? _b : 0); });
    return sortedConversationsHistory !== null && sortedConversationsHistory !== void 0 ? sortedConversationsHistory : [];
});
const fetchLatestUpdates = (slackUrl, channelIds, forwardedDays, maxMessagesInChannel) => __awaiter(void 0, void 0, void 0, function* () {
    const messagesOldestTimestamp = (0, date_fns_1.subDays)(new Date(), forwardedDays).getTime() / 1000;
    const conversationsHistoryList = yield Promise.all(channelIds.map((channelId) => __awaiter(void 0, void 0, void 0, function* () {
        const channelName = yield fetchChannelName(channelId);
        const channelUrl = getChannelURL(channelId, slackUrl);
        const messages = yield fetchLatestMessages(channelId, messagesOldestTimestamp, maxMessagesInChannel);
        return { channelName, channelUrl, messages };
    })));
    return conversationsHistoryList;
});
const replaceMentions = (text) => __awaiter(void 0, void 0, void 0, function* () {
    var _g, _h;
    if (!mentionRegExp.test(text)) {
        return text;
    }
    const mentionedUserIds = (_h = (_g = text.match(mentionRegExp)) === null || _g === void 0 ? void 0 : _g.map((mentionStr) => getUserIdFromMentionStr(mentionStr))) !== null && _h !== void 0 ? _h : [];
    const mentionedUsers = yield Promise.all(mentionedUserIds.map((mentionedUserId) => __awaiter(void 0, void 0, void 0, function* () {
        const mentionedUserName = yield fetchUserName(mentionedUserId);
        return [mentionedUserId, mentionedUserName];
    }))).then((mentionedUserEntries) => new Map(mentionedUserEntries));
    return text.replace(mentionRegExp, (mentionStr) => {
        var _a;
        const userId = getUserIdFromMentionStr(mentionStr);
        return (_a = mentionedUsers.get(userId)) !== null && _a !== void 0 ? _a : '';
    });
});
const composeForwardedMessage = (message, maxMessageLength) => __awaiter(void 0, void 0, void 0, function* () {
    const { text, user } = message;
    if (!text || !user) {
        return '';
    }
    const slicedText = text.slice(0, maxMessageLength);
    const slicedTextWithMentionsReplaced = yield replaceMentions(slicedText);
    const userName = yield fetchUserName(user);
    return `${userName}さんの投稿\n${slicedTextWithMentionsReplaced}`;
});
const composeForwardedContent = (conversationsHistoryList, maxMessageLength) => __awaiter(void 0, void 0, void 0, function* () {
    return Promise.all(conversationsHistoryList.map(({ channelName, channelUrl, messages }) => __awaiter(void 0, void 0, void 0, function* () {
        if (!messages.length) {
            return '';
        }
        const composedMessages = yield Promise.all(messages.map((message) => __awaiter(void 0, void 0, void 0, function* () { return composeForwardedMessage(message, maxMessageLength); })));
        const joinedMessages = composedMessages.filter((message) => message).join('\n\n');
        return `${channelName}に新着投稿があります\n\n${joinedMessages}\n\nslackで確認\n${channelUrl}`;
    }))).then((forwardedContents) => forwardedContents.filter((content) => content));
});
const notifyLine = (content, lineNotifyAccessToken) => __awaiter(void 0, void 0, void 0, function* () {
    const body = new URLSearchParams({ message: content });
    yield (0, node_fetch_1.default)(LINE_API_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${lineNotifyAccessToken}`,
        },
        body,
    })
        .then((res) => {
        // eslint-disable-next-line no-console
        console.log('Request sent! status:', res.status);
    })
        .catch((e) => {
        console.error(e);
    });
});
const handleNotifiedContents = (contents, lineNotifyAccessTokens) => __awaiter(void 0, void 0, void 0, function* () {
    contents.forEach((content) => __awaiter(void 0, void 0, void 0, function* () {
        lineNotifyAccessTokens.forEach((token) => __awaiter(void 0, void 0, void 0, function* () {
            notifyLine(content, token);
        }));
    }));
});
//
// main
//
const main = () => __awaiter(void 0, void 0, void 0, function* () {
    var _j, _k, _l, _m, _o, _p;
    const conversationsHistoryList = yield fetchLatestUpdates((_j = process.env.SLACK_URL) !== null && _j !== void 0 ? _j : '', (_l = (_k = process.env.FORWARDED_CHANNEL_IDS) === null || _k === void 0 ? void 0 : _k.split(' ')) !== null && _l !== void 0 ? _l : [], +((_m = process.env.FORWARDED_DAYS) !== null && _m !== void 0 ? _m : 7), process.env.MAX_MESSAGES_IN_CHANNEL);
    // eslint-disable-next-line no-console
    console.log('conversationsHistoryList.length:', conversationsHistoryList.length);
    const forwardedContents = yield composeForwardedContent(conversationsHistoryList, process.env.MAX_MESSAGE_LENGTH);
    yield handleNotifiedContents(forwardedContents, (_p = (_o = process.env.LINE_NOTIFY_ACCESS_TOKENS) === null || _o === void 0 ? void 0 : _o.split(' ')) !== null && _p !== void 0 ? _p : []);
});
// eslint-disable-next-line no-console
console.log('cron job to be set...', new Date().toISOString());
node_cron_1.default.schedule((_a = process.env.CRON_SETTING) !== null && _a !== void 0 ? _a : DEFAULT_CRON_SETTING, () => __awaiter(void 0, void 0, void 0, function* () {
    // eslint-disable-next-line no-console
    console.log('starting process...', new Date().toISOString());
    yield main();
    // eslint-disable-next-line no-console
    console.log('done', new Date().toISOString());
}));
//# sourceMappingURL=index.js.map