import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Image,
  Animated, StatusBar, Keyboard, FlatList, ScrollView
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import * as Location from 'expo-location';
import Banner from '../ads/Banner';
import { loadInterstitial, showInterstitial } from '../ads/InterstitialManager';
import { supabase } from '../supabase';

const GOOGLE_API_KEY = 'AIzaSyCk5wP6T55B_zu75Jx-9TLmpjoVfs93TZQ';
const TYPE_FILTERS = ['All', 'Classic', 'Self'];
const DISTANCES = [5, 10];
const CACHE_MOVE_THRESHOLD_KM = 0.5;

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
  { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#4b6878' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#023e58' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#283d6a' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#6f9ba5' }] },
  { featureType: 'poi.park', elementType: 'geometry.fill', stylers: [{ color: '#023e58' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#98a5be' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2c6675' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#b0d5ce' }] },
  { featureType: 'transit.line', elementType: 'geometry.fill', stylers: [{ color: '#283d6a' }] },
  { featureType: 'transit.station', elementType: 'geometry', stylers: [{ color: '#3a4762' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4e6d70' }] },
];

function getDistanceKm(lat1, lon1, lat2, lon2) {
  var R = 6371;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Animated pulse ring for locate button
const PulseRing = ({ anim }) => (
  <Animated.View style={{
    position: 'absolute',
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderColor: '#06b6d4',
    opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
    transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
  }} />
);

// Star rating component
const StarRating = ({ rating = 4.5, size = 11 }) => {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    stars.push(
      <Text key={i} style={{ fontSize: size, color: i <= Math.round(rating) ? '#FBBF24' : 'rgba(255,255,255,0.2)' }}>★</Text>
    );
  }
  return <View style={{ flexDirection: 'row' }}>{stars}</View>;
};

// Horizontal list card
const WashCard = React.memo(({ wash, onPress }) => {
  const isClassic = wash.type === 'classic';
  return (
    <TouchableOpacity style={styles.card} onPress={() => onPress(wash)} activeOpacity={0.85}>
      <View style={[styles.cardImagePlaceholder, { backgroundColor: isClassic ? 'rgba(6,182,212,0.15)' : 'rgba(124,58,237,0.15)' }]}>
        <Text style={{ fontSize: 28 }}>{isClassic ? '🚿' : '💧'}</Text>
      </View>
      <View style={styles.cardBody}>
        <View style={[styles.cardBadge, isClassic ? styles.badgeClassic : styles.badgeSelf]}>
          <Text style={styles.cardBadgeText}>{isClassic ? 'Classic' : 'Self'}</Text>
        </View>
        <Text style={styles.cardName} numberOfLines={1}>{wash.name || 'Car Wash'}</Text>
        <StarRating rating={wash.rating || 4.5} />
        <Text style={styles.cardDist}>📍 {wash.distanceKm?.toFixed(1)} km</Text>
      </View>
      <View style={styles.cardActions}>
        <TouchableOpacity style={styles.cardBtn} onPress={() => onPress(wash)}>
          <Text style={styles.cardBtnIcon}>➤</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.cardBtn, { marginTop: 6 }]}>
          <Text style={styles.cardBtnIcon}>📞</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
});

const CarWashMarker = React.memo(({ wash, onPress }) => (
  <Marker
    coordinate={{ latitude: wash.latitude, longitude: wash.longitude }}
    pinColor={wash.type === 'self' ? 'tomato' : 'lime'}
    tracksViewChanges={false}
    onPress={() => onPress(wash)}
  />
));

export default function MapScreen({ navigation }) {
  const [location, setLocation] = useState(null);
  const [searchLocation, setSearchLocation] = useState(null);
  const [carWashes, setCarWashes] = useState([]);
  const [activeFilter, setActiveFilter] = useState('All');
  const [distanceKm, setDistanceKm] = useState(5);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [selectedWash, setSelectedWash] = useState(null);
  const [showList, setShowList] = useState(false);
  const [favorites, setFavorites] = useState([]);
  const cardAnim = useRef(new Animated.Value(0)).current;
  const listAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadInterstitial();
  }, []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const mapRef = useRef(null);
  const isFetchingRef = useRef(false);
  const lastFetchedLocationRef = useRef(null);
  const lastFetchedDistanceRef = useRef(null);
  const autocompleteRef = useRef(null);

  const activeLocation = searchLocation || location;

  const filtered = useMemo(() => {
    if (!activeLocation || carWashes.length === 0) return [];
    return carWashes
      .map(c => ({
        ...c,
        distanceKm: getDistanceKm(activeLocation.latitude, activeLocation.longitude, c.latitude, c.longitude),
      }))
      .filter(c => {
        if (c.distanceKm > distanceKm) return false;
        if (activeFilter === 'Classic') return c.type === 'classic';
        if (activeFilter === 'Self') return c.type === 'self';
        return true;
      })
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }, [carWashes, activeFilter, activeLocation, distanceKm]);

  const bestRated = useMemo(() => {
    return [...filtered].sort((a, b) => (b.rating || 4.5) - (a.rating || 4.5)).slice(0, 10);
  }, [filtered]);

  useEffect(() => { getUserLocation(); }, []);

  useEffect(() => {
    if (!activeLocation) return;
    if (lastFetchedLocationRef.current && lastFetchedDistanceRef.current === distanceKm) {
      const movedKm = getDistanceKm(
        lastFetchedLocationRef.current.latitude,
        lastFetchedLocationRef.current.longitude,
        activeLocation.latitude,
        activeLocation.longitude
      );
      if (movedKm < CACHE_MOVE_THRESHOLD_KM) return;
    }
    fetchCarWashes();
  }, [activeLocation, distanceKm]);

  const showCard = useCallback((wash) => {
    setSelectedWash(wash);
    cardAnim.setValue(0);
    Animated.spring(cardAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 10 }).start();
  }, []);

  const hideCard = useCallback(() => {
    Animated.timing(cardAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      setSelectedWash(null);
    });
  }, []);

  const toggleList = useCallback(() => {
    const next = !showList;
    setShowList(next);
    Animated.spring(listAnim, { toValue: next ? 1 : 0, useNativeDriver: true, tension: 70, friction: 12 }).start();
  }, [showList]);

  const getUserLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission denied', 'Allow location access.'); setLoading(false); return; }
    const loc = await Location.getCurrentPositionAsync({});
    setLocation(loc.coords);
    setLoading(false);
  };

  const goToMyLocation = useCallback(() => {
    setSearchLocation(null);
    hideCard();
    if (autocompleteRef.current) autocompleteRef.current.clear();
    if (mapRef.current && location) {
      // Zoom in tight — street level for crowded cities
      mapRef.current.animateToRegion({
        latitude: location.latitude,
        longitude: location.longitude,
        latitudeDelta: 0.012,
        longitudeDelta: 0.012,
      }, 900);
    }
  }, [location]);

  const fetchCarWashes = async () => {
    if (!activeLocation || isFetchingRef.current) return;
    isFetchingRef.current = true;
    setFetching(true);
    const latBuffer = distanceKm / 111;
    const lonBuffer = distanceKm / (111 * Math.cos(activeLocation.latitude * Math.PI / 180));
    const { data, error } = await supabase
      .from('car_washes')
      .select('id, name, address, latitude, longitude, type')
      .gte('latitude', activeLocation.latitude - latBuffer)
      .lte('latitude', activeLocation.latitude + latBuffer)
      .gte('longitude', activeLocation.longitude - lonBuffer)
      .lte('longitude', activeLocation.longitude + lonBuffer)
      .limit(200);
    isFetchingRef.current = false;
    setFetching(false);
    if (error) { Alert.alert('Error', 'Could not load car washes.'); return; }
    lastFetchedLocationRef.current = { latitude: activeLocation.latitude, longitude: activeLocation.longitude };
    lastFetchedDistanceRef.current = distanceKm;
    setCarWashes((data || []).map(w => ({
      id: w.id, name: w.name, address: w.address,
      latitude: parseFloat(w.latitude), longitude: parseFloat(w.longitude),
      type: w.type, is_open: true, rating: (3.8 + Math.random() * 1.2).toFixed(1),
    })));
  };

  const handleMarkerPress = useCallback((wash) => {
    showInterstitial(() => navigation.navigate('DetailScreen', { item: wash }));
  }, [navigation]);

  const toggleFavorite = useCallback((id) => {
    setFavorites(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#0f0f1a" />
        <ActivityIndicator size="large" color="#7c3aed" />
        <Text style={styles.loadingText}>Finding your location...</Text>
      </View>
    );
  }

  const cardTranslateY = cardAnim.interpolate({ inputRange: [0, 1], outputRange: [200, 0] });
  const cardOpacity = cardAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const BOTTOM_SHEET_H = 170;
  const MINI_CARD_BOTTOM = BOTTOM_SHEET_H + 12;

  // List panel slide up
  const listTranslateY = listAnim.interpolate({ inputRange: [0, 1], outputRange: [320, 0] });
  const LIST_PANEL_H = 300;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        showsUserLocation={true}
        showsMyLocationButton={false}
        initialRegion={{
          latitude: activeLocation?.latitude || 44.4268,
          longitude: activeLocation?.longitude || 26.1025,
          latitudeDelta: 0.09,
          longitudeDelta: 0.09
        }}
        customMapStyle={DARK_MAP_STYLE}
        onPress={() => { hideCard(); Keyboard.dismiss(); }}
        moveOnMarkerPress={false}
      >
        {filtered.map(wash => (
          <CarWashMarker key={wash.id} wash={wash} onPress={handleMarkerPress} />
        ))}
      </MapView>

      {/* Search Bar */}
      <View style={styles.searchWrapper}>
        <GooglePlacesAutocomplete
          ref={autocompleteRef}
          placeholder="🔍  Search city or address..."
          fetchDetails={true}
          onPress={(data, details = null) => {
            const loc = details?.geometry?.location;
            if (!loc) return;
            const newLoc = { latitude: loc.lat, longitude: loc.lng };
            setSearchLocation(newLoc);
            if (mapRef.current) {
              mapRef.current.animateToRegion({
                latitude: loc.lat,
                longitude: loc.lng,
                latitudeDelta: distanceKm / 55,
                longitudeDelta: distanceKm / 55,
              }, 800);
            }
            Keyboard.dismiss();
          }}
          query={{ key: GOOGLE_API_KEY, language: 'ro' }}
          styles={{
            container: { flex: 0, zIndex: 100 },
            textInputContainer: {
              backgroundColor: 'rgba(15,15,35,0.92)',
              borderRadius: 28,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.12)',
              paddingHorizontal: 6,
              paddingVertical: 2,
            },
            textInput: { backgroundColor: 'transparent', color: '#fff', fontSize: 13, height: 44, marginBottom: 0 },
            listView: { backgroundColor: '#1a1a2e', borderRadius: 16, marginTop: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
            row: { backgroundColor: 'transparent', paddingVertical: 10, paddingHorizontal: 14 },
            description: { color: '#fff', fontSize: 13 },
            separator: { backgroundColor: 'rgba(255,255,255,0.07)', height: 1 },
            poweredContainer: { display: 'none' },
            powered: { display: 'none' },
          }}
          renderRightButton={() => null}
          enablePoweredByContainer={false}
          keepResultsAfterBlur={false}
          keyboardShouldPersistTaps="handled"
        />
      </View>

      {/* Right Side Buttons */}
      <View style={styles.sideButtons}>

        {/* Favorites — violet glow */}
        <TouchableOpacity
          style={[styles.sideBtn, styles.sideBtnFav]}
          onPress={() => Alert.alert('Favorites', `You have ${favorites.length} favorites`)}
          activeOpacity={0.8}
        >
          <Text style={{ fontSize: 22 }}>★</Text>
          <Text style={styles.sideBtnLabel}>Favorites</Text>
          {favorites.length > 0 && (
            <View style={styles.sideBadge}><Text style={styles.sideBadgeText}>{favorites.length}</Text></View>
          )}
        </TouchableOpacity>

        {/* Best Rated — gold glow */}
        <TouchableOpacity style={[styles.sideBtn, styles.sideBtnGold]} onPress={toggleList} activeOpacity={0.8}>
          <Text style={{ fontSize: 22 }}>🏆</Text>
          <Text style={[styles.sideBtnLabel, { color: '#FBBF24' }]}>Best{'\n'}Rated</Text>
        </TouchableOpacity>

        {/* Locate Me — modern cyan with pulse */}
        <TouchableOpacity style={[styles.sideBtn, styles.sideBtnLocate]} onPress={goToMyLocation} activeOpacity={0.8}>
          <PulseRing anim={pulseAnim} />
          {/* Navigation arrow SVG-style using unicode */}
          <View style={styles.locateArrow}>
            <Text style={{ fontSize: 22, color: '#06b6d4' }}>⊕</Text>
          </View>
          <Text style={[styles.sideBtnLabel, { color: '#06b6d4' }]}>Near{'\n'}Me</Text>
        </TouchableOpacity>

      </View>

      {/* Mini Card */}
      {selectedWash && (
        <Animated.View style={[
          styles.miniCard,
          { bottom: MINI_CARD_BOTTOM, opacity: cardOpacity, transform: [{ translateY: cardTranslateY }] }
        ]}>
          <View style={styles.miniHandle} />
          <View style={styles.miniContent}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <View style={[styles.miniBadge, selectedWash.type === 'self' ? styles.miniBadgeSelf : styles.miniBadgeClassic]}>
                <Text style={styles.miniBadgeText}>{selectedWash.type === 'self' ? '💧 Self Wash' : '🚿 Classic'}</Text>
              </View>
              <Text style={styles.miniName} numberOfLines={1}>{selectedWash.name || 'Car Wash'}</Text>
              <StarRating rating={selectedWash.rating || 4.5} size={13} />
              {selectedWash.address ? <Text style={styles.miniAddr} numberOfLines={1}>{selectedWash.address}</Text> : null}
              {selectedWash.distanceKm ? <Text style={styles.miniDist}>📍 {selectedWash.distanceKm.toFixed(1)} km away</Text> : null}
            </View>
            <View style={{ alignItems: 'center', gap: 8 }}>
              <TouchableOpacity
                style={styles.viewBtn}
                onPress={() => {
                  const washToOpen = { ...selectedWash };
                  hideCard();
                  setTimeout(() => showInterstitial(() => navigation.navigate('DetailScreen', { item: washToOpen })), 50);
                }}
              >
                <Text style={styles.viewBtnText}>View →</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.viewBtn, { backgroundColor: favorites.includes(selectedWash.id) ? '#FBBF24' : 'rgba(255,255,255,0.1)' }]}
                onPress={() => toggleFavorite(selectedWash.id)}
              >
                <Text style={styles.viewBtnText}>{favorites.includes(selectedWash.id) ? '★ Saved' : '☆ Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      )}

      {/* Best Rated Sliding List Panel */}
      {showList && (
        <Animated.View style={[styles.listPanel, { transform: [{ translateY: listTranslateY }], bottom: BOTTOM_SHEET_H }]}>
          <View style={styles.listPanelHeader}>
            <Text style={styles.listPanelTitle}>🏆 Best Rated Nearby</Text>
            <TouchableOpacity onPress={toggleList}>
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 18 }}>✕</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={bestRated}
            keyExtractor={item => item.id?.toString()}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}
            renderItem={({ item }) => (
              <WashCard wash={item} onPress={(wash) => {
                toggleList();
                setTimeout(() => showInterstitial(() => navigation.navigate('DetailScreen', { item: wash })), 100);
              }} />
            )}
          />
        </Animated.View>
      )}

      {/* Bottom Sheet */}
      <View style={styles.bottomSheet}>
        <View style={styles.sheetHandle} />

        <View style={styles.filtersRow}>
          {TYPE_FILTERS.map(f => {
            const isActive = activeFilter === f;
            return (
              <TouchableOpacity key={f} style={[styles.chip, isActive && styles.chipActive]} onPress={() => setActiveFilter(f)}>
                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                  {f === 'All' ? '✦ All' : f === 'Classic' ? '🚿 Classic' : '💧 Self'}
                </Text>
              </TouchableOpacity>
            );
          })}
          <View style={{ flex: 1 }} />
          <View style={styles.countBadge}>
            {fetching
              ? <ActivityIndicator size="small" color="#06b6d4" />
              : <Text style={styles.countText}>{filtered.length} found</Text>
            }
          </View>
        </View>

        <View style={styles.distRow}>
          <Text style={styles.distLabel}>Distance:</Text>
          {DISTANCES.map(km => {
            const isActive = distanceKm === km;
            return (
              <TouchableOpacity
                key={km}
                style={[styles.distBtn, isActive && styles.distBtnActive]}
                onPress={() => {
                  setDistanceKm(km); hideCard();
                  if (mapRef.current && activeLocation) mapRef.current.animateToRegion({
                    latitude: activeLocation.latitude,
                    longitude: activeLocation.longitude,
                    latitudeDelta: km / 55,
                    longitudeDelta: km / 55
                  }, 600);
                }}
              >
                <Text style={[styles.distBtnText, isActive && styles.distBtnTextActive]}>{km} km</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.legendRow}>
          <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: 'tomato' }]} /><Text style={styles.legendText}>Classic</Text></View>
          <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: 'lime' }]} /><Text style={styles.legendText}>Self Wash</Text></View>
          {searchLocation && (
            <TouchableOpacity style={styles.myLocBtn} onPress={goToMyLocation}>
              <Text style={styles.myLocText}>📍 My Location</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.bannerContainer}>
        <Banner />
      </View>

    </View>
  );
}

const GLASS = 'rgba(15,15,35,0.88)';
const BORDER = 'rgba(255,255,255,0.1)';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a' },
  bannerContainer: { position: 'absolute', bottom: 0, width: '100%' },
  map: { flex: 1 },
  loadingContainer: { flex: 1, backgroundColor: '#0f0f1a', justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 14, color: 'rgba(255,255,255,0.5)', fontSize: 15 },

  // Search
  searchWrapper: { position: 'absolute', top: 50, left: 12, right: 12, zIndex: 20 },

  // Side Buttons
  sideButtons: {
    position: 'absolute',
    right: 12,
    top: '35%',
    zIndex: 25,
    alignItems: 'center',
    gap: 10,
  },
  sideBtn: {
    width: 60,
    height: 66,
    borderRadius: 20,
    backgroundColor: 'rgba(20,20,45,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 12,
  },
  sideBtnFav: {
    backgroundColor: 'rgba(124,58,237,0.25)',
    borderColor: 'rgba(124,58,237,0.6)',
    shadowColor: '#7c3aed',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 14,
  },
  sideBtnGold: {
    backgroundColor: 'rgba(251,191,36,0.12)',
    borderColor: 'rgba(251,191,36,0.4)',
    shadowColor: '#FBBF24',
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  sideBtnLocate: {
    backgroundColor: 'rgba(6,182,212,0.15)',
    borderColor: 'rgba(6,182,212,0.5)',
    shadowColor: '#06b6d4',
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 14,
    overflow: 'visible',
  },
  locateArrow: { alignItems: 'center', justifyContent: 'center' },
  sideBtnIcon: { fontSize: 22, marginBottom: 2 },
  sideBtnLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 9, fontWeight: '700', textAlign: 'center', lineHeight: 11, marginTop: 2 },
  sideBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#7c3aed',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#0f0f1a',
  },
  sideBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },

  // Mini Card
  miniCard: { position: 'absolute', left: 12, right: 80, backgroundColor: GLASS, borderRadius: 20, borderWidth: 1, borderColor: BORDER, paddingTop: 8, paddingBottom: 16, paddingHorizontal: 16, elevation: 30, shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 20, zIndex: 30 },
  miniHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', alignSelf: 'center', marginBottom: 12 },
  miniContent: { flexDirection: 'row', alignItems: 'center' },
  miniBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, marginBottom: 6 },
  miniBadgeSelf: { backgroundColor: 'rgba(124,58,237,0.2)', borderWidth: 1, borderColor: 'rgba(124,58,237,0.4)' },
  miniBadgeClassic: { backgroundColor: 'rgba(6,182,212,0.15)', borderWidth: 1, borderColor: 'rgba(6,182,212,0.35)' },
  miniBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  miniName: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  miniAddr: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 4, marginBottom: 2 },
  miniDist: { color: '#06b6d4', fontSize: 12, fontWeight: '600', marginTop: 2 },
  viewBtn: { backgroundColor: '#7c3aed', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  viewBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },

  // List Panel
  listPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 280,
    backgroundColor: 'rgba(10,10,28,0.97)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    zIndex: 35,
    elevation: 40,
  },
  listPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  listPanelTitle: { color: '#fff', fontWeight: '800', fontSize: 15 },

  // Card
  card: {
    width: 160,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    marginRight: 10,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  cardImagePlaceholder: {
    height: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { padding: 10, flex: 1 },
  cardBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    marginBottom: 5,
  },
  badgeClassic: { backgroundColor: 'rgba(6,182,212,0.2)', borderWidth: 1, borderColor: 'rgba(6,182,212,0.4)' },
  badgeSelf: { backgroundColor: 'rgba(124,58,237,0.2)', borderWidth: 1, borderColor: 'rgba(124,58,237,0.4)' },
  cardBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  cardName: { color: '#fff', fontSize: 12, fontWeight: '700', marginBottom: 4 },
  cardDist: { color: '#06b6d4', fontSize: 10, marginTop: 4, fontWeight: '600' },
  cardActions: {
    flexDirection: 'column',
    padding: 8,
    paddingTop: 0,
    alignItems: 'flex-end',
  },
  cardBtn: {
    backgroundColor: 'rgba(124,58,237,0.3)',
    borderRadius: 10,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.5)',
  },
  cardBtnIcon: { fontSize: 14 },

  // Bottom Sheet
  bottomSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: GLASS, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: BORDER, paddingTop: 10, paddingBottom: 30, paddingHorizontal: 16, elevation: 20, shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 30, zIndex: 20 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', alignSelf: 'center', marginBottom: 14 },
  filtersRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: BORDER, backgroundColor: 'rgba(255,255,255,0.05)', marginRight: 8 },
  chipActive: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  chipText: { color: 'rgba(255,255,255,0.5)', fontWeight: '600', fontSize: 12 },
  chipTextActive: { color: '#fff' },
  countBadge: { paddingHorizontal: 12, paddingVertical: 5, backgroundColor: 'rgba(6,182,212,0.12)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(6,182,212,0.3)' },
  countText: { color: '#06b6d4', fontWeight: '700', fontSize: 12 },
  distRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  distLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 12, fontWeight: '600', marginRight: 10 },
  distBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: BORDER, backgroundColor: 'rgba(255,255,255,0.04)', marginRight: 8 },
  distBtnActive: { backgroundColor: 'rgba(6,182,212,0.18)', borderColor: '#06b6d4' },
  distBtnText: { color: 'rgba(255,255,255,0.4)', fontWeight: '600', fontSize: 12 },
  distBtnTextActive: { color: '#06b6d4' },
  legendRow: { flexDirection: 'row', alignItems: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 16 },
  legendDot: { width: 9, height: 9, borderRadius: 5, marginRight: 5 },
  legendText: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  myLocBtn: { marginLeft: 'auto', paddingHorizontal: 12, paddingVertical: 5, backgroundColor: 'rgba(124,58,237,0.2)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(124,58,237,0.35)' },
  myLocText: { color: '#a78bfa', fontSize: 12, fontWeight: '700' },
});
