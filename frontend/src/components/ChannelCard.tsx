import React from 'react';
import { View, Image, Text, StyleSheet, Pressable } from 'react-native';
import { useFavoritesStore } from '@/src/store/favoritesStore';
import type { Channel } from '@/src/api';

interface ChannelCardProps {
  channel: Channel;
}

export const ChannelCard: React.FC<ChannelCardProps> = ({ channel }) => {
  const { isFavorite, addFavorite, removeFavorite } = useFavoritesStore();
  const favorite = isFavorite(channel.id);

  const handleToggleFavorite = async () => {
    if (favorite) {
      await removeFavorite(channel.id);
    } else {
      await addFavorite(channel.id);
    }
  };

  return (
    <Pressable
      onPress={handleToggleFavorite}
      style={styles.container}
    >
      <View style={styles.iconWrapper}>
        {channel.logo ? (
          <Image
            source={{ uri: channel.logo }}
            style={styles.icon}
            resizeMode="contain"
          />
        ) : (
          <View style={styles.iconPlaceholder}>
            <Text style={styles.placeholderText}>📺</Text>
          </View>
        )}
        
        {favorite && (
          <View style={styles.starBadge}>
            <Text style={styles.starEmoji}>⭐</Text>
          </View>
        )}
      </View>
      
      <Text style={styles.name} numberOfLines={2}>
        {channel.name}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginHorizontal: 6,
    marginVertical: 10,
    flex: 1,
  },
  iconWrapper: {
    position: 'relative',
    width: 80,
    height: 80,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#f0f0f0',
    marginBottom: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  icon: {
    width: '100%',
    height: '100%',
  },
  iconPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    height: '100%',
  },
  placeholderText: {
    fontSize: 36,
  },
  starBadge: {
    position: 'absolute',
    bottom: -6,
    right: -6,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FFD700',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 5,
  },
  starEmoji: {
    fontSize: 16,
    lineHeight: 16,
  },
  name: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    maxWidth: 100,
    color: '#333',
  },
});
