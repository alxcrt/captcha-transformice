package org.transformice.database.embeds;

// Imports
import dev.morphia.annotations.Embedded;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.transformice.utils.Utils;

@Getter
@Embedded
@NoArgsConstructor(force = true)
public class TribeHistoricEntry {
    private final int type;
    private final int date;
    private final String information;

    public TribeHistoricEntry(int type, String information) {
        this.type = type;
        this.date = Utils.getTribulleTime();
        this.information = information;
    }
}