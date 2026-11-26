const loginPanel = document.querySelector("#login-panel");
const setupNotice = document.querySelector("#setup-notice");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const setupMessage = document.querySelector("#setup-message");
const dashboardMessage = document.querySelector("#dashboard-message");
const menuDialog = document.querySelector("#menu-dialog");
const menuForm = document.querySelector("#menu-form");
const menuDialogMessage = document.querySelector("#menu-dialog-message");
const menuList = document.querySelector("#menu-admin-list");
const reservationList = document.querySelector("#reservation-list");
const reservationFilter = document.querySelector("#reservation-filter");
const settingsForm = document.querySelector("#settings-form");
const statusLabels = {
  pending: "Në pritje",
  confirmed: "E konfirmuar",
  cancelled: "E anuluar"
};
let client = null;
let menuItems = [];
let editingMenuId = null;
let isOwner = false;

function showSetupMessage(message) {
  loginPanel.hidden = true;
  setupNotice.hidden = false;
  setupMessage.textContent = message;
}

function showLoginMessage(message) {
  loginMessage.textContent = message;
}

function showDashboardMessage(message) {
  dashboardMessage.textContent = message;
}

function showMenuDialogMessage(message) {
  menuDialogMessage.textContent = message;
}

function showLogin() {
  dashboard.hidden = true;
  loginPanel.hidden = false;
  showLoginMessage("");
}

function showDashboard(user) {
  loginPanel.hidden = true;
  dashboard.hidden = false;
  document.querySelector("#owner-email").textContent = user.email || "Pronari";
  document.querySelector("#dashboard-role").textContent = isOwner ? "PANELI I PRONARIT" : "PANELI I STAFIT";
  document.querySelectorAll(".owner-only").forEach((element) => {
    element.hidden = !isOwner;
  });
  document.querySelectorAll(".staff-readonly").forEach((element) => {
    element.hidden = isOwner;
  });
  document.querySelector("#view-menu .section-hint:not(.staff-readonly)").hidden = !isOwner;
  document.querySelector("#add-menu-item").hidden = !isOwner;
  settingsForm.querySelectorAll("input,button").forEach((element) => {
    element.disabled = !isOwner;
  });
  settingsForm.querySelector('[type="submit"]').hidden = !isOwner;
  showDashboardMessage("");
  refreshDashboard();
}

async function verifyAccess(user) {
  const [ownerResult, staffResult] = await Promise.all([
    client.rpc("is_restaurant_owner"),
    client.rpc("is_restaurant_staff")
  ]);
  if (ownerResult.error) throw ownerResult.error;
  if (staffResult.error) throw staffResult.error;
  if (!ownerResult.data && !staffResult.data) {
    await client.auth.signOut();
    showLoginMessage("Kjo llogari nuk është autorizuar nga pronari për të hyrë në panel.");
    return false;
  }
  isOwner = ownerResult.data === true;
  showDashboard(user);
  return true;
}

async function start() {
  const config = window.BUKE_ZEMER_BACKEND;
  if (!config?.supabaseUrl || !config?.supabaseAnonKey) {
    showSetupMessage("Lidhja me Supabase nuk është konfiguruar ende. Ndiqni udhëzimet për ta aktivizuar.");
    return;
  }
  if (!["http:", "https:"].includes(window.location.protocol)) {
    showSetupMessage("Hapeni panelin nga faqja e publikuar në HTTPS; hyrja nuk funksionon nga file://.");
    return;
  }

  try {
    client = await window.createRestaurantClient();
    if (!client) {
      showSetupMessage("Lidhja me Supabase nuk është konfiguruar ende.");
      return;
    }
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (data.session) {
      try {
        await verifyAccess(data.session.user);
      } catch (verificationError) {
        await client.auth.signOut();
        showLoginMessage(`Nuk u verifikua qasja në panel: ${verificationError.message}`);
      }
    }
  } catch (error) {
    showSetupMessage(`Lidhja me Supabase dështoi: ${error.message}`);
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!loginForm.reportValidity() || !client) return;
  const submitButton = loginForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  showLoginMessage("");
  try {
    const formData = new FormData(loginForm);
    const { data, error } = await client.auth.signInWithPassword({
      email: formData.get("email"),
      password: formData.get("password")
    });
    if (error) throw error;
    const authorized = await verifyAccess(data.user);
    if (authorized) loginForm.reset();
  } catch (error) {
    showLoginMessage(`Hyrja dështoi: ${error.message}`);
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("#sign-out").addEventListener("click", async () => {
  const { error } = await client.auth.signOut();
  if (error) {
    showDashboardMessage(`Dalja dështoi: ${error.message}`);
    return;
  }
  showLogin();
});

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab-button").forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("is-active", active);
      if (active) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
    document.querySelectorAll(".dashboard-view").forEach((view) => {
      const active = view.id === `view-${button.dataset.view}`;
      view.hidden = !active;
      view.classList.toggle("is-visible", active);
    });
    showDashboardMessage("");
  });
});

async function refreshDashboard() {
  const requests = [loadReservations(), loadMenu(), loadSettings()];
  if (isOwner) requests.push(loadStaff());
  await Promise.all(requests);
}

function statusSelect(reservation) {
  const select = document.createElement("select");
  select.setAttribute("aria-label", `Ndrysho statusin për ${reservation.customer_name}`);
  Object.entries(statusLabels).forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = reservation.status === value;
    select.append(option);
  });
  select.addEventListener("change", async () => {
    const { data, error } = await client.from("reservations")
      .update({ status: select.value })
      .eq("id", reservation.id)
      .select("id")
      .single();
    if (error) {
      showDashboardMessage(`Statusi nuk u ruajt: ${error.message}`);
      select.value = reservation.status;
      return;
    }
    if (!data) {
      showDashboardMessage("Rezervimi nuk u përditësua. Kontrolloni lejet e kësaj llogarie.");
      select.value = reservation.status;
      return;
    }
    showDashboardMessage("Statusi i rezervimit u përditësua.");
    await loadReservations();
  });
  return select;
}

function createReservationCard(reservation) {
  const card = document.createElement("article");
  card.className = "reservation-card";
  const guest = document.createElement("div");
  const name = document.createElement("h3");
  name.textContent = reservation.customer_name;
  const phone = document.createElement("a");
  phone.href = `tel:${reservation.phone.replace(/[^\d+]/g, "")}`;
  phone.textContent = reservation.phone;
  const contact = document.createElement("p");
  contact.append(phone);
  guest.append(name, contact);

  const visit = document.createElement("div");
  const date = document.createElement("p");
  date.textContent = `${reservation.reservation_date} · ${String(reservation.reservation_time).slice(0, 5)}`;
  const guests = document.createElement("p");
  guests.textContent = `${reservation.guests} ${reservation.guests === 1 ? "person" : "persona"}`;
  visit.append(date, guests);

  const status = document.createElement("div");
  status.append(statusSelect(reservation));
  const actions = document.createElement("div");
  if (isOwner) {
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "button button-quiet reservation-delete";
    deleteButton.textContent = "Fshi";
    deleteButton.addEventListener("click", async () => {
      if (!window.confirm(`A dëshironi ta fshini kërkesën e ${reservation.customer_name}?`)) return;
      const { error } = await client.from("reservations").delete().eq("id", reservation.id);
      if (error) {
        showDashboardMessage(`Rezervimi nuk u fshi: ${error.message}`);
        return;
      }
      showDashboardMessage("Rezervimi u fshi.");
      await loadReservations();
    });
    actions.append(deleteButton);
  }

  card.append(guest, visit, status, actions);
  if (!isOwner) card.classList.add("staff-card");
  if (reservation.message) {
    const note = document.createElement("p");
    note.textContent = `Shënim: ${reservation.message}`;
    note.className = "reservation-note";
    card.append(note);
  }
  return card;
}

async function loadReservations() {
  const { data, error } = await client.from("reservations")
    .select("id,customer_name,phone,reservation_date,reservation_time,guests,message,status,created_at")
    .order("created_at", { ascending: false });
  if (error) {
    showDashboardMessage(`Rezervimet nuk u ngarkuan: ${error.message}`);
    return;
  }

  const reservations = data || [];
  document.querySelector("#pending-count").textContent = String(
    reservations.filter((reservation) => reservation.status === "pending").length
  );
  const selectedStatus = reservationFilter.value;
  const visible = selectedStatus === "all"
    ? reservations
    : reservations.filter((reservation) => reservation.status === selectedStatus);
  reservationList.replaceChildren(...visible.map(createReservationCard));
  document.querySelector("#reservation-empty").hidden = visible.length > 0;
}

reservationFilter.addEventListener("change", loadReservations);

async function loadStaff() {
  const { data, error } = await client.from("restaurant_admins")
    .select("user_id,email,role,created_at")
    .eq("role", "staff")
    .order("created_at", { ascending: true });
  if (error) {
    showDashboardMessage(`Llogaritë e stafit nuk u ngarkuan: ${error.message}`);
    return;
  }

  const staff = data || [];
  const rows = staff.map((member) => {
    const row = document.createElement("article");
    row.className = "staff-row";
    const email = document.createElement("span");
    email.textContent = member.email || member.user_id;
    const revoke = document.createElement("button");
    revoke.type = "button";
    revoke.className = "button button-quiet";
    revoke.textContent = "Hiq qasjen";
    revoke.addEventListener("click", async () => {
      if (!window.confirm(`A dëshironi t’ia hiqni qasjen ${member.email} nga paneli?`)) return;
      const { error: revokeError } = await client.rpc("revoke_restaurant_staff", {
        staff_user_id: member.user_id
      });
      if (revokeError) {
        showDashboardMessage(`Qasja nuk u hoq: ${revokeError.message}`);
        return;
      }
      showDashboardMessage("Qasja e stafit u hoq.");
      await loadStaff();
    });
    row.append(email, revoke);
    return row;
  });
  document.querySelector("#staff-list").replaceChildren(...rows);
  document.querySelector("#staff-empty").hidden = staff.length > 0;
}

document.querySelector("#staff-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity() || !isOwner) return;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  showDashboardMessage("");
  try {
    const email = String(new FormData(form).get("email")).trim();
    const { error } = await client.rpc("grant_restaurant_staff", { staff_email: email });
    if (error) throw error;
    form.reset();
    showDashboardMessage("Llogaria u autorizua si staf. Ajo mund të menaxhojë vetëm statusin e rezervimeve.");
    await loadStaff();
  } catch (error) {
    showDashboardMessage(`Stafi nuk u autorizua: ${error.message}`);
  } finally {
    button.disabled = false;
  }
});

function localizedText(value, language) {
  if (value && typeof value === "object") return value[language] || value.en || value.sq || "";
  return value || "";
}

function createMenuRow(item) {
  const row = document.createElement("article");
  row.className = "menu-admin-row";
  const image = document.createElement("img");
  image.alt = "";
  if (item.image_url) image.src = item.image_url;

  const info = document.createElement("div");
  info.className = "menu-admin-row-info";
  const titleLine = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = localizedText(item.name, "sq");
  const price = document.createElement("strong");
  price.textContent = `€${Number(item.price).toFixed(2)}`;
  titleLine.append(title, price);
  const category = document.createElement("p");
  category.textContent = localizedText(item.category, "sq");
  const availability = document.createElement("p");
  availability.className = `availability-badge${item.is_available ? "" : " unavailable"}`;
  availability.textContent = item.is_available ? "Publikuar" : "I fshehur";
  info.append(titleLine, category, availability);

  row.append(image, info);
  if (isOwner) {
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "button button-quiet";
    edit.textContent = "Ndrysho";
    edit.addEventListener("click", () => openMenuEditor(item));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button button-quiet";
    remove.textContent = "Fshi";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`A dëshironi ta fshini “${localizedText(item.name, "sq")}” nga menuja?`)) return;
      const { data, error } = await client.from("menu_items")
        .delete()
        .eq("id", item.id)
        .select("id")
        .single();
      if (error) {
        showDashboardMessage(`Gatimi nuk u fshi: ${error.message}`);
        return;
      }
      if (!data) {
        showDashboardMessage("Gatimi nuk u fshi. Kontrolloni lejet e kësaj llogarie.");
        return;
      }
      showDashboardMessage("Gatimi u fshi nga menuja.");
      await loadMenu();
    });
    actions.append(edit, remove);
    row.append(actions);
  } else {
    row.classList.add("read-only");
  }
  return row;
}

async function loadMenu() {
  const { data, error } = await client.from("menu_items")
    .select("id,name,description,category,price,image_url,is_available,sort_order")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    showDashboardMessage(`Menuja nuk u ngarkua: ${error.message}`);
    return;
  }
  menuItems = data || [];
  menuList.replaceChildren(...menuItems.map(createMenuRow));
  document.querySelector("#menu-empty").textContent = isOwner
    ? "Menuja është bosh. Shtoni gatimin e parë ose ngarkoni menunë fillestare."
    : "Nuk ka gatime të publikuara për momentin.";
  document.querySelector("#menu-empty").hidden = menuItems.length > 0;
  document.querySelector("#import-menu").hidden = !isOwner || menuItems.length > 0;
  document.querySelector("#add-menu-item").hidden = !isOwner;
}

function setLocalizedFields(form, prefix, values) {
  ["sq", "it", "en"].forEach((language) => {
    form.elements.namedItem(`${prefix}-${language}`).value = values?.[language] || "";
  });
}

function openMenuEditor(item = null) {
  editingMenuId = item?.id || null;
  menuForm.reset();
  menuForm.elements.is_available.checked = item ? item.is_available : true;
  document.querySelector("#menu-dialog-title").textContent = item ? "Ndrysho gatimin" : "Shto gatim";
  menuForm.querySelector('[type="submit"]').textContent = item ? "Ruaj ndryshimet" : "Ruaj gatimin";
  showMenuDialogMessage("");

  if (item) {
    setLocalizedFields(menuForm, "name", item.name);
    setLocalizedFields(menuForm, "description", item.description);
    setLocalizedFields(menuForm, "category", item.category);
    menuForm.elements.price.value = Number(item.price).toFixed(2);
    menuForm.elements.sort_order.value = item.sort_order;
    menuForm.elements.image_url.value = item.image_url || "";
  }
  menuDialog.showModal();
}

document.querySelector("#add-menu-item").addEventListener("click", () => openMenuEditor());
document.querySelector("#close-menu-dialog").addEventListener("click", () => menuDialog.close());
document.querySelector("#cancel-menu-dialog").addEventListener("click", () => menuDialog.close());
menuDialog.addEventListener("click", (event) => {
  if (event.target === menuDialog) menuDialog.close();
});

menuForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!menuForm.reportValidity()) return;
  const submitButton = menuForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  showMenuDialogMessage("");
  try {
    const formData = new FormData(menuForm);
    let imageUrl = String(formData.get("image_url") || "").trim();
    if (imageUrl && !/^(https:\/\/|assets\/)[^\s]*$/i.test(imageUrl)) {
      throw new Error("Përdorni një URL HTTPS ose një shteg që fillon me assets/.");
    }
    const imageFile = formData.get("image_file");
    if (imageFile instanceof File && imageFile.size > 0) {
      if (imageFile.size > 5 * 1024 * 1024) throw new Error("Fotoja duhet të jetë më e vogël se 5 MB.");
      if (!["image/jpeg", "image/png", "image/webp"].includes(imageFile.type)) {
        throw new Error("Lejohen vetëm fotografi JPG, PNG ose WebP.");
      }
      const safeName = imageFile.name.replace(/[^\w.-]/g, "-");
      const path = `menu/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await client.storage
        .from("restaurant-images")
        .upload(path, imageFile, { cacheControl: "3600", contentType: imageFile.type, upsert: false });
      if (uploadError) throw uploadError;
      imageUrl = client.storage.from("restaurant-images").getPublicUrl(path).data.publicUrl;
    }

    const localized = (prefix) => Object.fromEntries(["sq", "it", "en"].map((language) => [
      language,
      String(formData.get(`${prefix}-${language}`) || "").trim()
    ]));
    const payload = {
      name: localized("name"),
      description: localized("description"),
      category: localized("category"),
      price: Number(formData.get("price")),
      image_url: imageUrl,
      is_available: formData.has("is_available"),
      sort_order: Number(formData.get("sort_order")),
      updated_at: new Date().toISOString()
    };
    const result = editingMenuId
      ? await client.from("menu_items").update(payload).eq("id", editingMenuId).select("id").single()
      : await client.from("menu_items").insert(payload).select("id").single();
    if (result.error) throw result.error;
    menuDialog.close();
    showDashboardMessage(editingMenuId ? "Gatimi u përditësua." : "Gatimi u shtua në menu.");
    await loadMenu();
  } catch (error) {
    showMenuDialogMessage(`Ruajtja dështoi: ${error.message}`);
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("#import-menu").addEventListener("click", async (event) => {
  if (menuItems.length > 0) return;
  if (!window.confirm("Do të ngarkohen 26 gatimet nga menuja fillestare. Vazhdo?")) return;
  const button = event.currentTarget;
  button.disabled = true;
  showDashboardMessage("");
  try {
    const response = await fetch("./menu-seed.json");
    if (!response.ok) throw new Error(`Të dhënat fillestare nuk u ngarkuan (${response.status}).`);
    const seed = await response.json();
    const rows = seed.map((item) => ({
      name: { sq: item.sq.name, it: item.it.name, en: item.en.name },
      description: { sq: item.sq.description, it: item.it.description, en: item.en.description },
      category: { sq: item.sq.category, it: item.it.category, en: item.en.category },
      price: item.price,
      image_url: item.image_url,
      is_available: true,
      sort_order: item.sort_order
    }));
    const { data, error } = await client.from("menu_items").insert(rows).select("id");
    if (error) throw error;
    if (data?.length !== rows.length) throw new Error("Nuk u ruajtën të gjitha gatimet.");
    showDashboardMessage("Menuja fillestare u ngarkua. Kontrollojeni para publikimit.");
    await loadMenu();
  } catch (error) {
    showDashboardMessage(`Menuja fillestare nuk u ngarkua: ${error.message}`);
  } finally {
    button.disabled = false;
  }
});

async function loadSettings() {
  const { data, error } = await client.from("restaurant_content")
    .select("content")
    .eq("id", "main")
    .maybeSingle();
  if (error) {
    showDashboardMessage(`Të dhënat e restorantit nuk u ngarkuan: ${error.message}`);
    return;
  }
  if (!data) return;
  const content = data.content;
  ["address", "city", "postal_code", "country", "phone"].forEach((field) => {
    settingsForm.elements.namedItem(field).value = content[field] || "";
  });
  setLocalizedFields(settingsForm, "hours", content.hours);
}

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!settingsForm.reportValidity()) return;
  const submitButton = settingsForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  showDashboardMessage("");
  try {
    const formData = new FormData(settingsForm);
    const content = {
      address: String(formData.get("address")).trim(),
      city: String(formData.get("city")).trim(),
      postal_code: String(formData.get("postal_code")).trim(),
      country: String(formData.get("country")).trim(),
      phone: String(formData.get("phone")).trim(),
      hours: {
        sq: String(formData.get("hours-sq")).trim(),
        it: String(formData.get("hours-it")).trim(),
        en: String(formData.get("hours-en")).trim()
      }
    };
    const { data, error } = await client.from("restaurant_content")
      .upsert({ id: "main", content, updated_at: new Date().toISOString() }, { onConflict: "id" })
      .select("id")
      .single();
    if (error) throw error;
    if (!data) throw new Error("Nuk u ruajtën të dhënat e restorantit.");
    showDashboardMessage("Të dhënat e restorantit u ruajtën.");
  } catch (error) {
    showDashboardMessage(`Ruajtja dështoi: ${error.message}`);
  } finally {
    submitButton.disabled = false;
  }
});

start();
