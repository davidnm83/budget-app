-- Pictures you upload for a merchant or an account, kept as a small image (resized in the app
-- to 128×128 before saving). `merchant` is the merchant's name, or "account:<id>" for an account.
alter table public.merchant_sites add column if not exists image text;
alter table public.merchant_sites alter column domain drop not null;
alter table public.merchant_sites add constraint merchant_sites_image_size check (image is null or length(image) < 200000);
