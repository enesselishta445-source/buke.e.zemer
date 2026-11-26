# Admin dashboard setup

The public website remains a static preview until its Supabase project is connected. The dashboard and reservation inbox become live only after the setup below; no Supabase credentials are included here.

## 1. Apply the role-based database schema

Open the existing Supabase project, go to **SQL Editor → New query**, and run the current `supabase-schema.sql` again. It safely adds the owner/staff roles and replaces the initial owner-only reservation permissions without deleting restaurant data.

Row-level security enforces these permissions:

- The owner can edit menu items, restaurant details and photos; manage reservations; and grant or revoke staff access.
- Only staff accounts explicitly authorized by the owner can sign in. Staff can view the restaurant information and reservations, and change a reservation's status. They cannot edit site content, manage accounts, or delete reservations.
- Visitors can read published menu/content and submit a pending reservation request. They cannot read reservation records.

## 2. Add the owner account

In Supabase **Authentication → Users**, create the owner's user with a strong password. Disable public sign-ups in **Authentication → Settings**. Copy the user's UUID and email, then run this in the SQL Editor:

```sql
insert into public.restaurant_admins (user_id, email, role)
values ('PASTE-OWNER-UUID-HERE', 'OWNER-EMAIL-HERE', 'owner')
on conflict (user_id) do update
set email = excluded.email, role = 'owner';
```

Never put a Supabase `service_role` key in this website or share account passwords.

## 3. Authorize selected staff

For each selected staff member, use Supabase **Authentication → Users → Invite user** to send an invitation to their personal work email. Then sign in to `/admin.html`, open **Stafi**, and authorize that exact email. The staff member can then log in with their own account.

Remove access from the dashboard's **Stafi** section whenever it is no longer needed. Do not share the owner's login with employees.

## 4. Connect the site

In Supabase **Project Settings → API**, copy the project URL and the public `anon`/publishable key into `backend-config.js`:

```js
window.BUKE_ZEMER_BACKEND = Object.freeze({
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR-PUBLIC-ANON-KEY"
});
```

The public key is designed for browser use; row-level security protects the data. Keep passwords and any `service_role` key private. Add bot protection or rate limiting for the public reservation form before sharing it widely.

## 5. Publish and use the panel

Host the `final` folder on an HTTPS static host and add that site's URL to Supabase **Authentication → URL Configuration**. The browser's `file://` preview cannot authenticate with Supabase.

Open `/admin.html` and sign in. When the menu is empty, the owner can import the 26 entries from `menu-seed.json`; review the dishes, translations, images and prices before treating them as current. Reservation requests appear as pending; staff can update their status, and the restaurant must still contact the guest to confirm the booking.

For a local HTTP test before publishing, open a terminal in the `final` folder, run `node serve-local.js`, then visit `http://127.0.0.1:8000/` or `http://127.0.0.1:8000/admin.html`. The local server binds only to this computer and is not public hosting.
