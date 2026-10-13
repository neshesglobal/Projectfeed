import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { PLACE_CATEGORIES, formatDistance, type LatLng, type Place } from "@projectfeed/shared";
import { errorMessage } from "../../src/api/client";
import { useCreatePlace, useNearbyPlaces } from "../../src/api/hooks";
import { Chip } from "../../src/components/glass";
import { MapPicker } from "../../src/components/maps/MapPreview";
import { SearchBar } from "../../src/components/SearchBar";
import { toast } from "../../src/components/Toast";
import { Button, EmptyState, Header, Loading, Screen, Text, TextField } from "../../src/components/ui";
import { cityAt, currentLocation } from "../../src/lib/maps";
import { useNotePlace } from "../../src/store/noteDraft";
import { space, useTheme } from "../../src/theme";

/** Add a new place: drop a pin on the map (free map display), name it, pick a category. */
function NewPlace({ start, initialName, onDone }: { start: LatLng; initialName: string; onDone: (p: Place) => void }) {
  const [pin, setPin] = useState(start);
  const [name, setName] = useState(initialName);
  const [category, setCategory] = useState<string>("");
  const [city, setCity] = useState("");
  const create = useCreatePlace();

  // City from the phone's own geocoder whenever the pin settles; free, and the user can correct it.
  useEffect(() => {
    let live = true;
    void cityAt(pin).then((r) => live && r.city && setCity(r.city));
    return () => {
      live = false;
    };
  }, [pin]);

  const save = async () => {
    try {
      const geo = await cityAt(pin);
      const r = await create.mutateAsync({ name: name.trim(), category, lat: pin.lat, lng: pin.lng, city: city.trim(), address: geo.address, country: geo.country });
      if (r.existing) toast(`“${r.place.name}” is already on Projectfeed, so we used it`);
      onDone(r.place);
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}>
      <MapPicker lat={start.lat} lng={start.lng} onChange={setPin} />
      <TextField label="Name" value={name} onChangeText={setName} placeholder="e.g. Mylapore Coffee House" maxLength={80} />
      <View style={{ gap: space.sm }}>
        <Text muted size="sm" weight="600" style={{ marginLeft: 4 }}>
          Category
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {PLACE_CATEGORIES.map((c) => (
            <Chip key={c} label={c} active={category === c} onPress={() => setCategory(category === c ? "" : c)} />
          ))}
        </View>
      </View>
      <TextField label="City" value={city} onChangeText={setCity} placeholder="City or town" maxLength={60} />
      <Button title="Add place" onPress={() => void save()} loading={create.isPending} disabled={name.trim().length < 2} />
      <Text muted size="xs" style={{ textAlign: "center" }}>
        Place the pin on the entrance so directions take people to the right spot.
      </Text>
    </ScrollView>
  );
}

/** Pick where a note was taken: places already on Projectfeed near you, or add a new one. */
export default function PlacePicker() {
  const t = useTheme();
  const setPlace = useNotePlace((s) => s.setPlace);
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const nearby = useNearbyPlaces(coords, q.trim());

  const locate = async () => {
    setError(null);
    const r = await currentLocation();
    if (r.ok) setCoords(r.coords);
    else setError(r.reason);
  };
  useEffect(() => {
    void locate();
  }, []);

  const choose = (p: Place) => {
    setPlace(p);
    router.back();
  };

  if (error && !coords) {
    return (
      <Screen>
        <Header title="Add location" />
        <EmptyState title="Location is off" body={error} action={<Button title="Try again" icon="locate" onPress={() => void locate()} />} />
      </Screen>
    );
  }
  if (!coords) {
    return (
      <Screen>
        <Header title="Add location" />
        <Loading />
      </Screen>
    );
  }
  if (adding) {
    return (
      <Screen>
        <Header title="New place" right={<Button small variant="ghost" title="Back" onPress={() => setAdding(false)} />} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <NewPlace start={coords} initialName={q} onDone={choose} />
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  const items = nearby.data?.items ?? [];
  return (
    <Screen>
      <Header title="Add location" />
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
        <SearchBar value={q} onChange={setQ} onSubmit={() => {}} placeholder="Search places near you" />
      </View>
      <FlatList
        data={items}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 80 }}
        ListHeaderComponent={
          <Pressable onPress={() => setAdding(true)} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="add" size={22} color={t.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text weight="700">{q.trim() ? `Add “${q.trim()}” as a new place` : "Add a new place"}</Text>
              <Text muted size="xs">
                Drop a pin on the map
              </Text>
            </View>
          </Pressable>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => choose(item)} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, opacity: pressed ? 0.6 : 1 })}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.bgInput, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="location-outline" size={20} color={t.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text weight="700" numberOfLines={1}>
                {item.name}
              </Text>
              <Text muted size="xs" numberOfLines={1}>
                {[item.category, item.city, item.distanceM !== undefined ? formatDistance(item.distanceM) : null, item.reviewCount ? `${item.reviewCount} reviews` : null].filter(Boolean).join(" · ")}
              </Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          nearby.isLoading ? (
            <Loading />
          ) : (
            <Text muted style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>
              {q.trim() ? "No places by that name near you yet." : "No places near you on Projectfeed yet. Add the first one."}
            </Text>
          )
        }
      />
    </Screen>
  );
}
