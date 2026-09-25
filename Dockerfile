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
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
