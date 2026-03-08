FROM maven:3.9-eclipse-temurin-22 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline -q
COPY src ./src
RUN mvn compile dependency:copy-dependencies -DoutputDirectory=target/deps -q

FROM eclipse-temurin:22-jre
WORKDIR /app
COPY --from=build /app/target/classes ./classes
COPY --from=build /app/target/deps ./deps
COPY config ./config
COPY config/properties.docker.json ./config/properties.json

EXPOSE 11802 12802 13802 14802

CMD ["java", "-cp", "classes:deps/*", "org.transformice.Application"]
