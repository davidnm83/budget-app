-- Whether an uploaded picture fills its circle (cropped) or sits inside it whole.
alter table public.merchant_sites add column if not exists fill boolean not null default true;
