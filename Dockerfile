FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Type-check-ul rulează și în build-ul de imagine: altfel cod care nu trece type-check ajunge în
# producție pe ușa din dos, fiindcă imaginea nu trece prin CI-ul de frontend.
RUN npm run type-check
RUN npm run build-only

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
# Ca **șablon**, nu ca `conf.d/default.conf`: imaginea oficială de nginx rulează `envsubst` peste
# `/etc/nginx/templates/*.template` la pornire, iar de acolo avem `${TTR_API_URL}` — adresa
# backend-ului TTR, care diferă între dezvoltare și producție. Variabilele nginx (`$host`, `$uri`)
# rămîn neatinse: scriptul substitue doar variabilele care există în mediu.
COPY nginx.conf /etc/nginx/templates/default.conf.template
ENV TTR_API_URL=http://host.docker.internal:5177/api/
EXPOSE 80
