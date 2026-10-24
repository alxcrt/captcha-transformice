FROM maven:3.9-eclipse-temurin-25 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline -q
COPY src ./src
COPY config ./config
RUN mvn test-compile dependency:copy-dependencies -DoutputDirectory=target/deps -q \
    && java -cp "target/test-classes:target/classes:target/deps/*" org.transformice.DecoderTest

FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=build /app/target/classes ./classes
COPY --from=build /app/target/deps ./deps
COPY config ./config
COPY config/properties.docker.json ./config/properties.json

EXPOSE 11802 12802 13802 14802

CMD ["java", "-cp", "classes:deps/*", "org.transformice.Application"]
