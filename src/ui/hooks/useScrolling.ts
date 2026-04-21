import { useState, useRef } from "react";
import type { ChatMessage } from "../components/types.js";

interface ScrollState {
  scrollOffset: number;
  autoScroll: boolean;
}

interface ScrollCalculations {
  MSGS_PER_SCREEN: number;
  maxOffset: number;
  safeOffset: number;
  endIdx: number;
  startIdx: number;
  visibleMessages: ChatMessage[];
  showScrollbar: boolean;
  barH: number;
  thumbH: number;
  thumbTop: number;
  scrollbarStr: string;
  scrollIndicator: string;
}

export function useScrolling(
  messages: ChatMessage[],
  msgAreaRows: number,
  inputLines: string[],
  suggestionsLength: number
) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const autoScroll = useRef(true);

  const totalMsgs = messages.length;
  const MSGS_PER_SCREEN = Math.max(8, Math.floor(msgAreaRows / 1.2));
  const maxOffset = Math.max(0, totalMsgs - Math.max(1, Math.floor(msgAreaRows / 2.5)));
  const safeOffset = Math.min(scrollOffset, maxOffset);
  const endIdx = totalMsgs - safeOffset;
  const startIdx = Math.max(0, endIdx - MSGS_PER_SCREEN);
  const visibleMessages = messages.slice(startIdx, safeOffset > 0 ? endIdx : undefined);

  // Scrollbar calculations
  const showScrollbar = totalMsgs > Math.floor(msgAreaRows / 2.5);
  const barH = msgAreaRows;
  const visibleCount = Math.max(1, Math.floor(msgAreaRows / 2.5));
  const thumbH = showScrollbar ? Math.max(1, Math.round((barH * visibleCount) / totalMsgs)) : barH;
  const thumbTop =
    showScrollbar && maxOffset > 0
      ? Math.round(((barH - thumbH) * (maxOffset - safeOffset)) / maxOffset)
      : 0;
  const scrollbarStr = Array.from({ length: barH }, (_, i) =>
    i >= thumbTop && i < thumbTop + thumbH ? "█" : "░"
  ).join("\n");

  // Scroll position indicator
  const scrollPct = totalMsgs > 0 ? Math.round((safeOffset / Math.max(1, maxOffset)) * 100) : 0;
  const msgStart = startIdx + 1;
  const msgEnd = endIdx;
  const scrollIndicator = `${msgStart}-${msgEnd}/${totalMsgs}${safeOffset > 0 ? ` (${scrollPct}%)` : ""}`;

  const calculations: ScrollCalculations = {
    MSGS_PER_SCREEN,
    maxOffset,
    safeOffset,
    endIdx,
    startIdx,
    visibleMessages,
    showScrollbar,
    barH,
    thumbH,
    thumbTop,
    scrollbarStr,
    scrollIndicator,
  };

  return {
    scrollOffset,
    setScrollOffset,
    autoScroll,
    calculations,
  };
}
