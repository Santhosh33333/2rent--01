import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  Alert as RNAlert,
} from 'react-native';
import { Image } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Colors } from '../../src/design-system/tokens/colors';
import { post, upload, errorMessage } from '../../src/lib/api';
import type { LocalFile } from '../../src/lib/api';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // backend MAX_FILE_SIZE
const MAX_VIDEO_BYTES = 25 * 1024 * 1024; // backend MAX_VIDEO_SIZE

const VISIBILITIES = [
  { key: 'PUBLIC', label: 'Everyone' },
  { key: 'FOLLOWERS', label: 'Friends' },
  { key: 'PRIVATE', label: 'Only me' },
];

function toLocalFile(asset: ImagePicker.ImagePickerAsset): LocalFile {
  const extMatch = asset.uri.match(/\.([a-zA-Z0-9]+)(\?|$)/);
  const ext = extMatch ? extMatch[1].toLowerCase() : asset.type === 'video' ? 'mp4' : 'jpg';
  const name = asset.fileName ?? `upload_${Date.now()}.${ext}`;
  const type = asset.mimeType ?? (asset.type === 'video' ? `video/${ext}` : `image/${ext}`);
  return { uri: asset.uri, name, type, size: asset.fileSize };
}

export default function NewPost() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState('PUBLIC');
  const [image, setImage] = useState<LocalFile | null>(null);
  const [video, setVideo] = useState<LocalFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        allowsEditing: false,
      });
      if (result.canceled || !result.assets[0]) return;
      const file = toLocalFile(result.assets[0]);
      if (file.size && file.size > MAX_IMAGE_BYTES) {
        RNAlert.alert('Photo too large', 'Photos are limited to 5 MB on this build.');
        return;
      }
      setVideo(null);
      setImage(file);
      setErrorMsg('');
    } catch {
      setErrorMsg('Could not open the photo library.');
    }
  };

  const pickVideo = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
      });
      if (result.canceled || !result.assets[0]) return;
      const file = toLocalFile(result.assets[0]);
      if (file.size && file.size > MAX_VIDEO_BYTES) {
        RNAlert.alert('Video too large', 'Videos are limited to 25 MB — keep clips short.');
        return;
      }
      setImage(null);
      setVideo(file);
      setErrorMsg('');
    } catch {
      setErrorMsg('Could not open the video library.');
    }
  };

  const publish = async () => {
    const text = content.trim();
    if (!text && !image && !video) {
      setErrorMsg('Add some text, a photo or a video before publishing.');
      return;
    }
    if (text.length > 2000) {
      setErrorMsg('Text is limited to 2,000 characters.');
      return;
    }
    setBusy(true);
    setErrorMsg('');
    try {
      let imageUrl: string | undefined;
      let videoUrl: string | undefined;
      if (video) {
        const up = await upload('/posts/video', 'video', video);
        videoUrl = up.data?.videoUrl;
      } else if (image) {
        const up = await upload('/posts/image', 'image', image);
        imageUrl = up.data?.imageUrl;
      }
      const res = await post('/posts', { content: text, imageUrl, videoUrl, visibility });
      if (!res.success) throw new Error(res.message || 'Could not publish');
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      router.back();
    } catch (e) {
      setErrorMsg(errorMessage(e, 'Could not publish. Check the video size — max 25 MB.'));
    } finally {
      setBusy(false);
    }
  };

  const removeMedia = () => {
    setImage(null);
    setVideo(null);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.topbar}>
        <TouchableOpacity onPress={() => router.back()} disabled={busy}>
          <Text style={styles.cancel}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.heading}>New post</Text>
        <TouchableOpacity onPress={publish} disabled={busy}>
          {busy ? <ActivityIndicator color={Colors.primary} /> : <Text style={styles.postBtn}>Post</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {errorMsg ? (
          <View style={styles.alert}>
            <Text style={styles.alertText}>{errorMsg}</Text>
          </View>
        ) : null}

        <TextInput
          style={styles.input}
          placeholder="What's on your mind?"
          placeholderTextColor={Colors.outline}
          value={content}
          onChangeText={setContent}
          multiline
          maxLength={2000}
        />

        {image ? (
          <View style={styles.previewWrap}>
            <Image source={{ uri: image.uri }} style={styles.previewImage} contentFit="cover" />
            <TouchableOpacity style={styles.removeBtn} onPress={removeMedia}>
              <Text style={styles.removeText}>✕ Remove</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {video ? (
          <View style={styles.previewWrap}>
            <Video
              source={{ uri: video.uri }}
              style={styles.previewVideo}
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay={false}
              useNativeControls
            />
            <TouchableOpacity style={styles.removeBtn} onPress={removeMedia}>
              <Text style={styles.removeText}>✕ Remove</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.mediaRow}>
          <TouchableOpacity style={styles.mediaBtn} onPress={pickImage} disabled={busy}>
            <Text style={styles.mediaIcon}>📷</Text>
            <Text style={styles.mediaLabel}>{image ? 'Change photo' : 'Add photo'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.mediaBtn} onPress={pickVideo} disabled={busy}>
            <Text style={styles.mediaIcon}>🎬</Text>
            <Text style={styles.mediaLabel}>{video ? 'Change video' : 'Add video'}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>Who can see this?</Text>
        <View style={styles.segmentRow}>
          {VISIBILITIES.map((v) => {
            const active = visibility === v.key;
            return (
              <TouchableOpacity
                key={v.key}
                style={[styles.segment, active && styles.segmentActive]}
                onPress={() => setVisibility(v.key)}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{v.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.backgroundDark },
  topbar: {
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: { color: Colors.onSurfaceDark, fontSize: 18, fontWeight: '800' },
  cancel: { color: Colors.onSurfaceVariant, fontSize: 15 },
  postBtn: { color: Colors.primary, fontSize: 15, fontWeight: '800' },
  body: { padding: 20, paddingBottom: 60 },
  alert: { backgroundColor: 'rgba(179,38,30,0.18)', borderRadius: 12, padding: 12, marginBottom: 14 },
  alertText: { color: Colors.onSurfaceDark, fontSize: 13 },
  input: {
    backgroundColor: Colors.surfaceDark,
    color: Colors.onSurfaceDark,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    minHeight: 110,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    textAlignVertical: 'top',
  },
  previewWrap: { marginTop: 14, borderRadius: 14, overflow: 'hidden', backgroundColor: '#000' },
  previewImage: { width: '100%', height: 210 },
  previewVideo: { width: '100%', height: 210 },
  removeBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  removeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  mediaRow: { flexDirection: 'row', gap: 12, marginTop: 14 },
  mediaBtn: {
    flex: 1,
    backgroundColor: Colors.surfaceDark,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    paddingVertical: 16,
    alignItems: 'center',
  },
  mediaIcon: { fontSize: 24 },
  mediaLabel: { color: Colors.onSurfaceVariant, fontSize: 13, marginTop: 6 },
  sectionLabel: { color: Colors.onSurfaceVariant, fontSize: 13, marginTop: 22, marginBottom: 8 },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segment: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceDark,
    paddingVertical: 12,
    alignItems: 'center',
  },
  segmentActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
  segmentText: { color: Colors.onSurfaceVariant, fontSize: 13 },
  segmentTextActive: { color: Colors.primary, fontWeight: '700' },
});