import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Linking, Alert, TextInput, ActivityIndicator, Image, StatusBar, Dimensions, Modal
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { AdMobInterstitial } from 'expo-ads-admob';
import { supabase } from '../supabase';

const SUPABASE_STORAGE_URL = 'https://klrppkphsiunguhjiyhh.supabase.co/storage/v1/object/public/car-wash-photos/';
import { OPENAI_API_KEY } from '@env';

// ─── ADMIN CONFIG — schimba PIN-ul doar de aici ───────────────────────────────
const ADMIN_PIN = '240184'; // <-beau 1 bere
// ─────────────────────────────────────────────────────────────────────────────

const BANNED_WORDS = [
  'pula','pizda','muie','cur','futut','fututi','futu-ti','dracu','dracului',
  'cacat','rahat','prostu','idiot','retardat','handicapat','curva','labagiu',
  'pulă','pizdă','căcat','nenorocit','mizerabil','ucide','ucis','omor','tigan',
  'fuck','shit','bitch','asshole','cunt','dick','cock','pussy',
  'bastard','motherfucker','nigger','faggot','retard','kill','murder','rape',
];

var checkBannedWords = (text) => BANNED_WORDS.some(w => text.toLowerCase().includes(w));

var checkOpenAIModeration = async (text) => {
  try {
    var res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENAI_API_KEY },
      body: JSON.stringify({ input: text }),
    });
    var data = await res.json();
    return data.results?.[0]?.flagged || false;
  } catch (e) { return false; }
};

var moderateComment = async (text) => {
  if (!text?.trim()) return { ok: true };
  if (checkBannedWords(text)) return { ok: false, reason: 'Your comment contains inappropriate language.' };
  if (await checkOpenAIModeration(text)) return { ok: false, reason: 'Your comment was flagged as inappropriate. Please keep reviews respectful.' };
  return { ok: true };
};

const GLASS = 'rgba(15,15,35,0.9)';
const GLASS_LIGHT = 'rgba(255,255,255,0.06)';
const BORDER = 'rgba(255,255,255,0.1)';
const CYAN = '#06b6d4';
const PURPLE = '#7c3aed';
const PURPLE_LIGHT = '#a78bfa';
const INTERSTITIAL_AD_UNIT_ID = 'ca-app-pub-1972507475258139/7100663729';

export default function DetailScreen({ route }) {
  useEffect(() => {
    AdMobInterstitial.setAdUnitID(INTERSTITIAL_AD_UNIT_ID);
    AdMobInterstitial.requestAdAsync().catch(() => {});
  }, []);

  useEffect(() => {
    showInterstitial();
  }, []);

  const { wash } = route.params ?? {};
  if (!wash) return null;

  const [washData, setWashData] = useState(wash);
  const [ratings, setRatings] = useState([]);
  const [avgRating, setAvgRating] = useState(null);
  const [newRating, setNewRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reportingType, setReportingType] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);

  // ─── Admin state ──────────────────────────────────────────────────────────
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinAttempts, setPinAttempts] = useState(0);
  const [pinLocked, setPinLocked] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminDeleting, setAdminDeleting] = useState(false);
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => { fetchFreshWashData(); fetchRatings(); fetchPhotos(); }, []);

  var fetchFreshWashData = async () => {
    var result = await supabase.from('car_washes').select('*').eq('id', wash.id).single();
    if (!result.error && result.data) {
      var w = result.data;
      setWashData({ id: w.id, name: w.name, address: w.address, latitude: parseFloat(w.latitude), longitude: parseFloat(w.longitude), type: w.type, is_open: true, distanceKm: wash.distanceKm });
    }
  };

  var fetchPhotos = async () => {
    var result = await supabase.from('car_wash_photos').select('*').eq('car_wash_id', wash.id).order('created_at', { ascending: false });
    if (!result.error && result.data) setPhotos(result.data);
  };

  var fetchRatings = async () => {
    var result = await supabase.from('ratings').select('*').eq('car_wash_id', wash.id).order('created_at', { ascending: false });
    if (!result.error && result.data) {
      setRatings(result.data);
      if (result.data.length > 0) setAvgRating((result.data.reduce((s, r) => s + r.rating, 0) / result.data.length).toFixed(1));
    }
    setLoading(false);
  };

  const showInterstitial = async () => {
    try {
      const ready = await AdMobInterstitial.getIsReadyAsync();
      if (ready) {
        await AdMobInterstitial.showAdAsync();
      }
      AdMobInterstitial.requestAdAsync().catch(() => {});
    } catch (e) {
      console.log('Interstitial error:', e);
    }
  };

  var doUpload = async (uri, base64) => {
    try {
      var filename = 'carwash_' + wash.id + '_' + Date.now() + '.jpg';
      var binary = atob(base64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      var uploadResult = await supabase.storage.from('car-wash-photos').upload(filename, bytes.buffer, { contentType: 'image/jpeg', upsert: false });
      if (uploadResult.error) { Alert.alert('Upload failed', uploadResult.error.message); setUploadingPhoto(false); return; }
      var insertResult = await supabase.from('car_wash_photos').insert({ car_wash_id: wash.id, photo_url: SUPABASE_STORAGE_URL + filename });
      if (insertResult.error) { Alert.alert('Error', 'Could not save photo reference.'); }
      else { Alert.alert('Thank you!', 'Your photo has been added!'); fetchPhotos(); setCurrentPhotoIndex(0); }
    } catch(e) { Alert.alert('Error', e.message); }
    setUploadingPhoto(false);
  };

  var uploadPhoto = async () => {
    var p = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!p.granted) { Alert.alert('Permission needed', 'Please allow access to your photos.'); return; }
    var r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [16,9], quality: 0.7, base64: true });
    if (r.canceled) return;
    setUploadingPhoto(true);
    try { await doUpload(r.assets[0].uri, r.assets[0].base64); } catch(e) { Alert.alert('Error', e.message); setUploadingPhoto(false); }
  };

  var takePhoto = async () => {
    var p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) { Alert.alert('Permission needed', 'Please allow camera access.'); return; }
    var r = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [16,9], quality: 0.7, base64: true });
    if (r.canceled) return;
    setUploadingPhoto(true);
    try { await doUpload(r.assets[0].uri, r.assets[0].base64); } catch(e) { Alert.alert('Error', e.message); setUploadingPhoto(false); }
  };

  var MAX_PHOTOS = 2;

  var showPhotoOptions = () => Alert.alert('Add a Photo', 'Help other users!', [
    { text: 'Take Photo', onPress: takePhoto },
    { text: 'Choose from Gallery', onPress: uploadPhoto },
    { text: 'Cancel', style: 'cancel' },
  ]);

  // ─── Info button: tap = copy ID, long press = admin ──────────────────────
  var showLocationId = async () => {
    await Clipboard.setStringAsync(washData.id);
    Alert.alert('Location ID', washData.id, [
      { text: '✓ Copied!', style: 'default' },
      { text: 'OK' },
    ]);
  };

  var handleInfoLongPress = () => {
    if (pinLocked) return;
    if (adminUnlocked) {
      setShowAdminPanel(true);
    } else {
      setPinInput('');
      setShowPinModal(true);
    }
  };
  // ─────────────────────────────────────────────────────────────────────────

  var handlePinSubmit = () => {
    if (pinInput === ADMIN_PIN) {
      setAdminUnlocked(true);
      setShowPinModal(false);
      setPinInput('');
      setPinAttempts(0);
      setShowAdminPanel(true);
    } else {
      var attempts = pinAttempts + 1;
      setPinAttempts(attempts);
      setPinInput('');
      if (attempts >= 3) {
        setPinLocked(true);
        setShowPinModal(false);
        Alert.alert('Locked', 'Too many failed attempts. Restart the app to try again.');
      } else {
        Alert.alert('Wrong PIN', (3 - attempts) + ' attempt(s) remaining.');
      }
    }
  };

  // ─── Admin actions ────────────────────────────────────────────────────────
  var adminDeleteLocation = () => {
    Alert.alert('Delete Location', 'This will permanently delete the location, all photos and all reviews. Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'DELETE', style: 'destructive', onPress: async () => {
        setAdminDeleting(true);
        await supabase.from('car_wash_photos').delete().eq('car_wash_id', wash.id);
        await supabase.from('ratings').delete().eq('car_wash_id', wash.id);
        var result = await supabase.from('car_washes').delete().eq('id', wash.id);
        setAdminDeleting(false);
        if (result.error) { Alert.alert('Error', result.error.message); }
        else { Alert.alert('Deleted', 'Location removed successfully.'); setShowAdminPanel(false); }
      }}
    ]);
  };

  var adminDeletePhotos = () => {
    Alert.alert('Delete All Photos', 'Remove all ' + photos.length + ' photo(s) for this location?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'DELETE', style: 'destructive', onPress: async () => {
        setAdminDeleting(true);
        await supabase.from('car_wash_photos').delete().eq('car_wash_id', wash.id);
        setAdminDeleting(false);
        Alert.alert('Done', 'All photos deleted.');
        fetchPhotos();
        setShowAdminPanel(false);
      }}
    ]);
  };

  var adminDeleteReviews = () => {
    Alert.alert('Delete All Reviews', 'Remove all ' + ratings.length + ' review(s) for this location?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'DELETE', style: 'destructive', onPress: async () => {
        setAdminDeleting(true);
        await supabase.from('ratings').delete().eq('car_wash_id', wash.id);
        setAdminDeleting(false);
        Alert.alert('Done', 'All reviews deleted.');
        fetchRatings();
        setShowAdminPanel(false);
      }}
    ]);
  };
  // ─────────────────────────────────────────────────────────────────────────

  var openGoogleMaps = () => Linking.openURL('https://www.google.com/maps/dir/?api=1&destination=' + washData.latitude + ',' + washData.longitude + '&travelmode=driving').catch(() => Alert.alert('Error', 'Could not open Google Maps'));
  var openWaze = () => Linking.openURL('https://waze.com/ul?ll=' + washData.latitude + ',' + washData.longitude + '&navigate=yes').catch(() => Alert.alert('Error', 'Could not open Waze'));

  var submitRating = async () => {
    if (newRating === 0) { Alert.alert('Select a rating', 'Please tap a star before submitting.'); return; }
    if (comment.trim()) {
      setSubmitting(true);
      var modResult = await moderateComment(comment.trim());
      if (!modResult.ok) { setSubmitting(false); Alert.alert('Comment not allowed', modResult.reason); return; }
    }
    setSubmitting(true);
    var result = await supabase.from('ratings').insert({ car_wash_id: wash.id, rating: newRating, comment: comment.trim() || null });
    setSubmitting(false);
    if (result.error) { Alert.alert('Error', 'Could not submit rating.'); }
    else { Alert.alert('Thank you! 🎉', 'Your rating has been submitted.'); setNewRating(0); setComment(''); fetchRatings(); }
  };

  var reportTypeCorrection = (newType) => {
    if (newType === washData.type) return;
    Alert.alert('Report Incorrect Type', 'Are you sure this is a ' + (newType === 'self' ? 'Self Wash' : 'Classic Wash') + '?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Yes, correct it', onPress: async () => {
        setReportingType(true);
        var result = await supabase.from('car_washes').update({ type: newType }).eq('id', wash.id);
        setReportingType(false);
        if (result.error) Alert.alert('Error', 'Could not update type.');
        else { setWashData(prev => ({ ...prev, type: newType })); Alert.alert('Thank you!', 'Type updated!'); }
      }}
    ]);
  };

  var renderStars = (rating, interactive, size) => (
    <View style={{ flexDirection: 'row' }}>
      {[1,2,3,4,5].map(star => (
        <TouchableOpacity key={star} onPress={() => { if (interactive) setNewRating(star); }} disabled={!interactive}>
          <Text style={{ fontSize: size || 22, color: star <= rating ? '#f59e0b' : 'rgba(255,255,255,0.15)' }}>
            {star <= rating ? '★' : '☆'}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 50 }}>
      <StatusBar barStyle="light-content" backgroundColor="#0f0f1a" />

      {/* Photo Section */}
      {photos.length > 0 ? (
        <View style={styles.imageContainer}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / Dimensions.get('window').width);
              setCurrentPhotoIndex(idx);
            }}
            scrollEnabled={photos.length > 1}
          >
            {photos.map((photo, i) => (
              <Image key={i} source={{ uri: photo.photo_url }} style={[styles.heroImage, { width: Dimensions.get('window').width }]} resizeMode="cover" />
            ))}
          </ScrollView>
          <View style={styles.imageOverlay} />
          {photos.length > 1 && (
            <View style={styles.photoNav}>
              <Text style={styles.photoNavBtn}>‹</Text>
              <Text style={styles.photoCount}>{currentPhotoIndex+1} / {photos.length}</Text>
              <Text style={styles.photoNavBtn}>›</Text>
            </View>
          )}
          {photos.length < MAX_PHOTOS ? (
            <TouchableOpacity style={styles.addPhotoOverlay} onPress={showPhotoOptions}>
              <Text style={styles.addPhotoText}>+ Photo</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.addPhotoOverlay}>
              <Text style={styles.addPhotoText}>📷 {photos.length}/2</Text>
            </View>
          )}
        </View>
      ) : (
        <View style={styles.noImageContainer}>
          {uploadingPhoto ? <ActivityIndicator color={PURPLE} size="large" /> : (
            <>
              <Text style={styles.noImageIcon}>📷</Text>
              <Text style={styles.noImageText}>No photos yet</Text>
              <TouchableOpacity style={styles.addPhotoBtn} onPress={showPhotoOptions}>
                <Text style={styles.addPhotoBtnText}>Be the first to add a photo</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {uploadingPhoto && photos.length > 0 && (
        <View style={styles.uploadingBar}>
          <ActivityIndicator color={CYAN} size="small" />
          <Text style={styles.uploadingText}>Uploading photo...</Text>
        </View>
      )}

      {/* Main Info Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{washData.name}</Text>
              {/* tap = copy ID | long press (70s) = admin */}
              <TouchableOpacity
                style={styles.infoBtn}
                onPress={showLocationId}
                onLongPress={handleInfoLongPress}
                delayLongPress={70000}
              >
                <Text style={styles.infoBtnText}>{adminUnlocked ? '⚙️' : 'ⓘ'}</Text>
              </TouchableOpacity>
            </View>
            {washData.address && <Text style={styles.address}>📍 {washData.address}</Text>}
            {washData.distanceKm && <Text style={styles.distance}>{washData.distanceKm.toFixed(1)} km away</Text>}
          </View>
          <View style={[styles.typeBadge, washData.type === 'self' ? styles.typeBadgeSelf : styles.typeBadgeClassic]}>
            <Text style={styles.typeBadgeText}>{washData.type === 'self' ? '💧 Self' : '🚿 Classic'}</Text>
          </View>
        </View>

        {avgRating && (
          <View style={styles.ratingRow}>
            {renderStars(Math.round(avgRating), false, 16)}
            <Text style={styles.ratingText}>{avgRating} <Text style={styles.ratingCount}>({ratings.length} review{ratings.length !== 1 ? 's' : ''})</Text></Text>
          </View>
        )}

        <View style={styles.divider} />

        <Text style={styles.reportLabel}>Is the type wrong? Help the community:</Text>
        <View style={styles.reportRow}>
          {reportingType ? <ActivityIndicator color={PURPLE} /> : (
            <>
              <TouchableOpacity style={[styles.reportBtn, washData.type === 'classic' && styles.reportBtnActive]} onPress={() => reportTypeCorrection('classic')}>
                <Text style={[styles.reportBtnText, washData.type === 'classic' && styles.reportBtnTextActive]}>
                  {washData.type === 'classic' ? '✓ Classic' : 'Actually Classic'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.reportBtn, washData.type === 'self' && styles.reportBtnActive]} onPress={() => reportTypeCorrection('self')}>
                <Text style={[styles.reportBtnText, washData.type === 'self' && styles.reportBtnTextActive]}>
                  {washData.type === 'self' ? '✓ Self Wash' : 'Actually Self Wash'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* Navigation Buttons */}
      <View style={styles.navRow}>
        <TouchableOpacity style={[styles.navBtn, styles.googleBtn]} onPress={openGoogleMaps}>
          <Text style={styles.navBtnIcon}>🗺️</Text>
          <Text style={styles.navBtnText}>Google Maps</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.navBtn, styles.wazeBtn]} onPress={openWaze}>
          <Text style={styles.navBtnIcon}>🚗</Text>
          <Text style={styles.navBtnText}>Waze</Text>
        </TouchableOpacity>
      </View>

      {/* Rate Card */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Rate This Car Wash</Text>
        <Text style={styles.sectionSubtitle}>Tap a star to select your rating</Text>
        <View style={styles.starsRow}>{renderStars(newRating, true, 40)}</View>
        <TextInput
          style={styles.commentInput}
          placeholder="Leave a comment (optional)..."
          placeholderTextColor="rgba(255,255,255,0.25)"
          value={comment}
          onChangeText={setComment}
          multiline={true}
          maxLength={200}
        />
        <TouchableOpacity style={[styles.submitBtn, submitting && styles.submitBtnDisabled]} onPress={submitRating} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Submit Rating ✨</Text>}
        </TouchableOpacity>
      </View>

      {/* Reviews Card */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Reviews</Text>
        {loading && <ActivityIndicator color={PURPLE} style={{ marginVertical: 20 }} />}
        {!loading && ratings.length === 0 && <Text style={styles.noReviews}>No reviews yet. Be the first! ⭐</Text>}
        {ratings.map(r => (
          <View key={r.id} style={styles.reviewItem}>
            <View style={styles.reviewHeader}>
              {renderStars(r.rating, false, 14)}
              <Text style={styles.reviewDate}>{new Date(r.created_at).toLocaleDateString()}</Text>
            </View>
            {r.comment && <Text style={styles.reviewComment}>{r.comment}</Text>}
          </View>
        ))}
      </View>

      {/* ─── PIN Modal ──────────────────────────────────────────────────────── */}
      <Modal visible={showPinModal} transparent animationType="fade" onRequestClose={() => setShowPinModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>🔐 Admin Access</Text>
            <Text style={styles.modalSubtitle}>Enter 6-digit PIN</Text>
            <TextInput
              style={styles.pinInput}
              value={pinInput}
              onChangeText={v => { if (v.length <= 6) setPinInput(v); }}
              keyboardType="numeric"
              secureTextEntry={true}
              maxLength={6}
              placeholder="••••••"
              placeholderTextColor="rgba(255,255,255,0.2)"
              autoFocus={true}
            />
            <Text style={styles.attemptsText}>
              {pinAttempts > 0 ? (3 - pinAttempts) + ' attempt(s) remaining' : ' '}
            </Text>
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalBtnCancel} onPress={() => { setShowPinModal(false); setPinInput(''); }}>
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtnConfirm, pinInput.length < 6 && { opacity: 0.4 }]} onPress={handlePinSubmit} disabled={pinInput.length < 6}>
                <Text style={styles.modalBtnConfirmText}>Unlock</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ─── Admin Panel Modal ───────────────────────────────────────────────── */}
      <Modal visible={showAdminPanel} transparent animationType="slide" onRequestClose={() => setShowAdminPanel(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.adminBox}>
            <Text style={styles.adminTitle}>⚙️ Admin Panel</Text>
            <Text style={styles.adminLocationName} numberOfLines={1}>{washData.name}</Text>

            {adminDeleting ? (
              <ActivityIndicator color={PURPLE} size="large" style={{ marginVertical: 30 }} />
            ) : (
              <>
                <TouchableOpacity style={styles.adminBtn} onPress={adminDeletePhotos}>
                  <Text style={styles.adminBtnIcon}>🖼️</Text>
                  <View>
                    <Text style={styles.adminBtnText}>Delete Photos</Text>
                    <Text style={styles.adminBtnSub}>{photos.length} photo(s) attached</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity style={styles.adminBtn} onPress={adminDeleteReviews}>
                  <Text style={styles.adminBtnIcon}>⭐</Text>
                  <View>
                    <Text style={styles.adminBtnText}>Delete Reviews</Text>
                    <Text style={styles.adminBtnSub}>{ratings.length} review(s) attached</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.adminBtn, styles.adminBtnDanger]} onPress={adminDeleteLocation}>
                  <Text style={styles.adminBtnIcon}>🗑️</Text>
                  <View>
                    <Text style={[styles.adminBtnText, { color: '#f87171' }]}>Delete Location</Text>
                    <Text style={styles.adminBtnSub}>Removes location + all data</Text>
                  </View>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity style={styles.adminCloseBtn} onPress={() => setShowAdminPanel(false)}>
              <Text style={styles.adminCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a' },
  imageContainer: { width: '100%', height: 240, position: 'relative' },
  heroImage: { width: '100%', height: 240 },
  imageOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, backgroundColor: 'rgba(15,15,35,0.6)' },
  photoNav: { position: 'absolute', top: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(15,15,35,0.7)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 1, borderColor: BORDER },
  photoNavBtn: { color: '#fff', fontSize: 22, fontWeight: 'bold', paddingHorizontal: 8 },
  photoNavBtnDisabled: { color: 'rgba(255,255,255,0.2)' },
  photoCount: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600' },
  addPhotoOverlay: { position: 'absolute', bottom: 12, right: 12, backgroundColor: 'rgba(124,58,237,0.75)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(124,58,237,0.5)' },
  addPhotoText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  noImageContainer: { width: '100%', height: 170, backgroundColor: 'rgba(255,255,255,0.03)', justifyContent: 'center', alignItems: 'center', borderBottomWidth: 1, borderColor: BORDER },
  noImageIcon: { fontSize: 36, marginBottom: 8 },
  noImageText: { color: 'rgba(255,255,255,0.3)', fontSize: 14, marginBottom: 14 },
  addPhotoBtn: { backgroundColor: 'rgba(124,58,237,0.25)', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(124,58,237,0.4)' },
  addPhotoBtnText: { color: PURPLE_LIGHT, fontWeight: '700', fontSize: 14 },
  uploadingBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6,182,212,0.1)', paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderColor: BORDER },
  uploadingText: { color: CYAN, fontSize: 13, fontWeight: '600' },
  card: { backgroundColor: GLASS_LIGHT, marginHorizontal: 12, marginTop: 12, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: BORDER },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  name: { fontSize: 20, fontWeight: '800', color: '#fff', letterSpacing: 0.3, flex: 1 },
  infoBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  infoBtnText: { color: 'rgba(255,255,255,0.45)', fontSize: 14, fontWeight: '700' },
  address: { fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 2 },
  distance: { fontSize: 13, color: CYAN, fontWeight: '700' },
  typeBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, marginLeft: 10 },
  typeBadgeSelf: { backgroundColor: 'rgba(124,58,237,0.2)', borderWidth: 1, borderColor: 'rgba(124,58,237,0.4)' },
  typeBadgeClassic: { backgroundColor: 'rgba(6,182,212,0.15)', borderWidth: 1, borderColor: 'rgba(6,182,212,0.35)' },
  typeBadgeText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  ratingText: { color: '#f59e0b', fontWeight: '700', fontSize: 14, marginLeft: 8 },
  ratingCount: { color: 'rgba(255,255,255,0.35)', fontWeight: '400', fontSize: 12 },
  divider: { height: 1, backgroundColor: BORDER, marginBottom: 12 },
  reportLabel: { fontSize: 12, color: 'rgba(255,255,255,0.3)', marginBottom: 10 },
  reportRow: { flexDirection: 'row', gap: 8 },
  reportBtn: { flex: 1, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: BORDER, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)' },
  reportBtnActive: { backgroundColor: 'rgba(124,58,237,0.2)', borderColor: 'rgba(124,58,237,0.5)' },
  reportBtnText: { fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: '600' },
  reportBtnTextActive: { color: PURPLE_LIGHT },
  navRow: { flexDirection: 'row', marginHorizontal: 12, marginTop: 12, gap: 10 },
  navBtn: { flex: 1, paddingVertical: 14, borderRadius: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, borderWidth: 1 },
  googleBtn: { backgroundColor: 'rgba(66,133,244,0.2)', borderColor: 'rgba(66,133,244,0.4)' },
  wazeBtn: { backgroundColor: 'rgba(0,188,212,0.15)', borderColor: 'rgba(0,188,212,0.35)' },
  navBtnIcon: { fontSize: 16 },
  navBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: '#fff', marginBottom: 4, letterSpacing: 0.3 },
  sectionSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 14 },
  starsRow: { marginBottom: 14 },
  commentInput: { borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 14, fontSize: 14, color: '#fff', backgroundColor: 'rgba(255,255,255,0.04)', minHeight: 70, textAlignVertical: 'top', marginBottom: 14 },
  submitBtn: { backgroundColor: PURPLE, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 0.5 },
  noReviews: { color: 'rgba(255,255,255,0.25)', fontStyle: 'italic', textAlign: 'center', paddingVertical: 16 },
  reviewItem: { borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 12, marginTop: 12 },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  reviewDate: { fontSize: 11, color: 'rgba(255,255,255,0.2)' },
  reviewComment: { fontSize: 14, color: 'rgba(255,255,255,0.65)', lineHeight: 20 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center' },
  modalBox: { backgroundColor: '#1a1a2e', borderRadius: 24, padding: 28, width: '80%', borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 6 },
  modalSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 20 },
  pinInput: { width: '100%', borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 14, fontSize: 22, color: '#fff', backgroundColor: 'rgba(255,255,255,0.05)', textAlign: 'center', letterSpacing: 8, marginBottom: 6 },
  attemptsText: { fontSize: 12, color: '#f87171', marginBottom: 20, height: 18 },
  modalBtns: { flexDirection: 'row', gap: 12, width: '100%' },
  modalBtnCancel: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  modalBtnCancelText: { color: 'rgba(255,255,255,0.5)', fontWeight: '600' },
  modalBtnConfirm: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: PURPLE, alignItems: 'center' },
  modalBtnConfirmText: { color: '#fff', fontWeight: '700' },
  adminBox: { backgroundColor: '#1a1a2e', borderRadius: 24, padding: 24, width: '88%', borderWidth: 1, borderColor: BORDER },
  adminTitle: { fontSize: 20, fontWeight: '800', color: '#fff', marginBottom: 4 },
  adminLocationName: { fontSize: 13, color: 'rgba(255,255,255,0.35)', marginBottom: 20 },
  adminBtn: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: BORDER },
  adminBtnDanger: { borderColor: 'rgba(248,113,113,0.3)', backgroundColor: 'rgba(248,113,113,0.08)' },
  adminBtnIcon: { fontSize: 22 },
  adminBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  adminBtnSub: { fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 2 },
  adminCloseBtn: { marginTop: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  adminCloseBtnText: { color: 'rgba(255,255,255,0.5)', fontWeight: '600' },
});
