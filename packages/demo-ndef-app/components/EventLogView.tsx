import React from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { clearEventLog, LogEntry, useEventLog } from './eventLog.ts';
import { colors, monospaceFont } from './ui.tsx';

function formatTime(time: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return (
    `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}` +
    `.${pad(time.getMilliseconds(), 3)}`
  );
}

// zero-width space between all characters, so the lines wrap at any character like in a terminal
function wrapAnywhere(text: string): string {
  return Array.from(text).join('​');
}

function LogLine({ entry }: { entry: LogEntry }) {
  return (
    <Text style={styles.line} textBreakStrategy="simple">
      <Text style={styles.time}>{wrapAnywhere(formatTime(entry.time) + ' ')}</Text>
      <Text style={entry.source === 'bg' ? styles.sourceBackground : styles.sourceForeground}>
        {wrapAnywhere(entry.source + ' ')}
      </Text>
      {wrapAnywhere(entry.text)}
    </Text>
  );
}

/**
 * Scrollable log of HCE events, both from the views ("fg") and from the background handler ("bg").
 * Sticks to the bottom unless scrolled up.
 */
function EventLogView() {
  const entries = useEventLog();
  const scrollRef = React.useRef<ScrollView>(null);
  const stickToBottom = React.useRef(true);
  const viewportHeight = React.useRef(0);
  const contentHeight = React.useRef(0);

  const scrollToBottom = () => {
    // the content size is reported before the native content view is resized, so scrolling right
    // away would be clamped to the previous end - wait for the next frame
    requestAnimationFrame(() => {
      if (stickToBottom.current) {
        const y = Math.max(0, contentHeight.current - viewportHeight.current);
        scrollRef.current?.scrollTo({ y, animated: false });
      }
    });
  };

  // only the user's scrolling decides whether to follow the new entries, as the scroll events
  // caused by the content growing report the new content size along with the stale offset
  const onUserScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    stickToBottom.current =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - 24;
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Event log</Text>
        <Pressable onPress={clearEventLog} hitSlop={12}>
          <Text style={styles.clear}>Clear</Text>
        </Pressable>
      </View>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        onScrollEndDrag={onUserScrollEnd}
        onMomentumScrollEnd={onUserScrollEnd}
        onLayout={e => {
          viewportHeight.current = e.nativeEvent.layout.height;
          scrollToBottom();
        }}
        onContentSizeChange={(_width, height) => {
          contentHeight.current = height;
          scrollToBottom();
        }}
      >
        {entries.length === 0 ? (
          <Text style={[styles.line, styles.time]}>No events yet.</Text>
        ) : (
          entries.map(entry => <LogLine key={entry.id} entry={entry} />)
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 160,
    backgroundColor: colors.logBackground,
    borderRadius: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.logMuted,
  },
  title: {
    color: colors.logText,
    fontSize: 13,
    fontWeight: '600',
  },
  clear: {
    color: colors.logForeground,
    fontSize: 13,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 12,
  },
  line: {
    fontFamily: monospaceFont,
    fontSize: 12,
    lineHeight: 17,
    color: colors.logText,
  },
  time: {
    color: colors.logMuted,
  },
  sourceForeground: {
    color: colors.logForeground,
  },
  sourceBackground: {
    color: colors.logBackgroundTask,
  },
});

export default EventLogView;
