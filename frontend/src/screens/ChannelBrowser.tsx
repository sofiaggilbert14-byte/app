import React, { useEffect, useMemo } from 'react';
import { FlatList, View, StyleSheet, ActivityIndicator } from 'react-native';
import { ChannelCard } from '@/src/components/ChannelCard';
import { useFavoritesStore } from '@/src/store/favoritesStore';
import type { Channel } from '@/src/api';

interface ChannelBrowserProps {
  channels: Channel[];
  loading?: boolean;
}

export const ChannelBrowser: React.FC<ChannelBrowserProps> = ({ 
  channels, 
  loading = false 
}) => {
  const { loadFavorites, initialized } = useFavoritesStore();

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  const memoizedChannels = useMemo(() => channels, [channels]);

  if (!initialized) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#6200ee" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={memoizedChannels}
        keyExtractor={(item) => item.id}
        numColumns={3}
        renderItem={({ item }) => <ChannelCard channel={item} />}
        contentContainerStyle={styles.grid}
        scrollEnabled={true}
        removeClippedSubviews={true}
        maxToRenderPerBatch={9}
        updateCellsBatchingPeriod={50}
      />
      {loading && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#6200ee" />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  grid: {
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
